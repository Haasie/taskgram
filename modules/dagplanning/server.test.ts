import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app.js';
import type { Config } from '../../server/config.js';
import { createModuleRuntime } from '../../server/modules/routes.js';
import { createModuleStore } from '../../server/modules/store.js';
import { MODULES } from '../../server/modules/discover.js';
import { UpstreamError, type PostgramClient, type RawEntity } from '../../server/postgram.js';
import { createEstimator } from './estimator.js';

const SECRET = 'x'.repeat(40);
const config: Config = {
  pgmApiUrl: 'https://postgram.example',
  pgmApiKey: 'k',
  auth: { mode: 'proxy', userHeader: 'x-cosmos-user', secretHeader: 'x-proxy-secret', secret: SECRET, allowedUsers: new Set(['alice']), loginPath: '/api/login' },
  port: 0,
  staticDir: './does-not-exist',
  appTimezone: 'Europe/Amsterdam'
};
const headers = { 'x-proxy-secret': SECRET, 'x-cosmos-user': 'alice', 'x-requested-with': 'taskgram', 'content-type': 'application/json' };

const DAY = '2026-11-16'; // maandag
const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

/** Postgram in het geheugen: genoeg voor taken en documenten, met versiecontrole zoals de echte. */
function fakePg(seed: RawEntity[]) {
  const store = new Map(seed.map((e) => [e.id, structuredClone(e)]));
  let next = 1000;
  const patch = (eid: string, body: any) => {
    const e = store.get(eid);
    if (!e) throw new UpstreamError(404, 'NOT_FOUND', 'not found');
    if (body.version !== undefined && body.version !== e.version) throw new UpstreamError(409, 'CONFLICT', 'conflict');
    if (body.content !== undefined) e.content = body.content;
    if (body.status !== undefined) e.status = body.status;
    if (body.metadata) e.metadata = { ...(e.metadata ?? {}), ...body.metadata };
    e.version += 1;
    return structuredClone(e);
  };
  const pg = {
    listTasks: vi.fn(async (status: string) => [...store.values()].filter((e) => e.type === 'task' && e.status === status).map((e) => structuredClone(e))),
    listEntities: vi.fn(async (type: string, tags: string[]) =>
      [...store.values()].filter((e) => e.type === type && tags.every((t) => e.tags.includes(t))).map((e) => structuredClone(e))
    ),
    getEntity: vi.fn(async (eid: string) => structuredClone(store.get(eid)!)),
    createEntity: vi.fn(async (body: any) => {
      const e: RawEntity = { id: id(next++), type: body.type, content: body.content, status: null, visibility: body.visibility, version: 1, tags: body.tags, metadata: body.metadata, created_at: '', updated_at: '' } as RawEntity;
      store.set(e.id, e);
      return structuredClone(e);
    }),
    updateEntity: vi.fn(async (eid: string, body: any) => patch(eid, body)),
    updateTask: vi.fn(async (eid: string, body: any) => patch(eid, body))
  };
  return { pg: pg as unknown as PostgramClient, store, spies: pg };
}

function task(i: number, content: string, extra: Partial<RawEntity> = {}): RawEntity {
  return {
    id: id(i),
    type: 'task',
    content,
    status: 'next',
    visibility: 'work',
    version: 1,
    tags: [],
    created_at: '2026-11-01T08:00:00Z',
    updated_at: '2026-11-01T08:00:00Z',
    ...extra,
    metadata: { start_date: DAY, ...((extra.metadata as object) ?? {}) }
  } as RawEntity;
}

function setup(seed: RawEntity[], opts: { enabled?: boolean; estimator?: (titles: string[]) => Promise<number[] | null> } = {}) {
  const { pg, store, spies } = fakePg(seed);
  const moduleStore = createModuleStore(mkdtempSync(join(tmpdir(), 'tg-dagplanning-')), MODULES);
  if (opts.enabled !== false) moduleStore.setEnabled('dagplanning', true);
  const runtime = createModuleRuntime({ pg, store: moduleStore, env: {}, timeZone: 'Europe/Amsterdam' });
  if (opts.estimator) (runtime.contexts.get('dagplanning')!.state as any).estimator = opts.estimator;
  const app = createApp(config, pg, { moduleRuntime: runtime });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api/modules/dagplanning${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, json: (await res.json()) as any };
  };
  return { call, store, spies, runtime };
}

afterEach(() => vi.useRealTimers());

describe('dagplanning: ochtend', () => {
  it('staat standaard uit en vraagt dan niets aan Postgram', async () => {
    const { call, spies } = setup([task(1, 'Erik bellen')], { enabled: false });
    expect(MODULES.find((m) => m.id === 'dagplanning')?.defaultEnabled).toBe(false);
    const res = await call('GET', `/day?date=${DAY}`);
    expect(res.status).toBe(404);
    expect(spies.listTasks).not.toHaveBeenCalled();
  });

  it('stelt een plan voor dat past en telt de inbox alleen', async () => {
    const { call } = setup([
      task(1, 'Erik bellen'),
      task(2, 'Demo opleveren', { metadata: { estimate_min: 240, estimate_source: 'ai' } }),
      task(3, 'Iets in de inbox', { status: 'inbox', metadata: { start_date: null } })
    ]);
    const { status, json } = await call('GET', `/day?date=${DAY}`);
    expect(status).toBe(200);
    expect(json.plan).toBeNull();
    // 15 × 1,5 = 23 past; 240 × 1,5 = 360 past niet in 300 min werk.
    expect(json.suggested).toEqual([id(1)]);
    expect(json.inbox).toBe(1);
    expect(json.today.map((t: any) => t.title)).toEqual(['Erik bellen', 'Demo opleveren']);
    expect(json.today[1]).toMatchObject({ estimate: 240, source: 'ai', bucket: 'work' });
    expect(json.factor).toEqual({ factor: 1.5, days: 0, learned: false });
    expect(json.ai).toBe(false);
  });

  it('weigert een overvol plan tot je het bewust bevestigt, en zet gekozen taken op Vandaag', async () => {
    const { call, store } = setup([
      task(1, 'Demo opleveren', { metadata: { estimate_min: 240 } }),
      task(2, 'Klein ding', { status: 'next', metadata: { start_date: null, estimate_min: 15, priority: 4 } })
    ]);
    const body = { date: DAY, planned: [id(1), id(2)], workMode: 'normal' };
    const refused = await call('PUT', '/day', body);
    expect(refused.status).toBe(409);
    expect(refused.json.error.code).toBe('OVERCOMMITTED');
    expect([...store.values()].filter((e) => e.type === 'document')).toHaveLength(0);

    const ok = await call('PUT', '/day', { ...body, ackOver: true });
    expect(ok.status).toBe(200);
    const doc = [...store.values()].find((e) => e.type === 'document')!;
    expect(doc.tags).toEqual(['dagplan']);
    expect(doc.content).not.toContain('Demo'); // geen titels in het dagplan
    expect(doc.metadata).toMatchObject({ date: DAY, planned: [id(1), id(2)], ack_over: true, closed: false, est: { [id(1)]: 240, [id(2)]: 15 } });
    expect(store.get(id(2))!.metadata).toMatchObject({ start_date: DAY });
  });

  it('verplaatst gisteren-gemist naar later en sluit gisteren vanzelf af', async () => {
    const yesterday = '2026-11-15';
    const { call, store } = setup([
      task(1, 'Bleef liggen', { metadata: { start_date: yesterday } }),
      task(2, 'Wel gedaan', { status: 'done', metadata: { start_date: yesterday, completed_at: '2026-11-15T14:00:00Z' } }),
      {
        id: id(50), type: 'document', content: '', status: null, visibility: 'personal', version: 1, tags: ['dagplan'], created_at: '', updated_at: '',
        metadata: { date: yesterday, planned: [id(1), id(2)], est: {}, agents: [], work_mode: 'off', closed: false, done: [] }
      } as RawEntity
    ]);
    const view = await call('GET', `/day?date=${DAY}`);
    expect(view.json.leftovers.map((t: any) => t.id)).toEqual([id(1)]);
    expect(store.get(id(50))!.metadata).toMatchObject({ closed: true, done: [id(2)] });

    const saved = await call('PUT', '/day', { date: DAY, planned: [], workMode: 'normal', moves: [{ id: id(1), to: 'later' }] });
    expect(saved.status).toBe(200);
    expect(store.get(id(1))).toMatchObject({ status: 'next', metadata: { start_date: null } });
  });
});

describe('dagplanning: opnieuw plannen', () => {
  it('houdt een al afgeronde geplande taak in het plan', async () => {
    const { call, store } = setup([task(1, 'Klaar'), task(2, 'Nog bezig')]);
    await call('PUT', '/day', { date: DAY, planned: [id(1), id(2)], workMode: 'normal' });
    store.get(id(1))!.status = 'done';
    store.get(id(1))!.metadata.completed_at = '2026-11-16T10:00:00Z';
    await call('PUT', '/day', { date: DAY, planned: [id(1), id(2)], workMode: 'busy' });
    const doc = [...store.values()].find((e) => e.type === 'document')!;
    expect(doc.metadata).toMatchObject({ planned: [id(1), id(2)], work_mode: 'busy' });
    expect(Object.keys(doc.metadata.est as object).sort()).toEqual([id(1), id(2)]);
    const view = await call('GET', `/day?date=${DAY}`);
    expect(view.json.plan.done).toEqual([id(1)]);
  });
});

describe('dagplanning: schatten', () => {
  it('AI vult ontbrekende schattingen in; alleen titels gaan mee', async () => {
    const estimator = vi.fn(async (titles: string[]) => titles.map(() => 45));
    const { call, store } = setup([task(1, 'Rapport reviewen\n\nGeheime notities hier'), task(2, 'Agentklus', { tags: ['agent'] })], { estimator });
    const res = await call('POST', '/estimate', { date: DAY });
    expect(res.json).toEqual({ estimated: 1, source: 'ai' });
    expect(estimator).toHaveBeenCalledWith(['Rapport reviewen']);
    expect(store.get(id(1))!.metadata).toMatchObject({ estimate_min: 45, estimate_source: 'ai' });
    expect(store.get(id(2))!.metadata.estimate_min).toBeUndefined();
  });

  it('valt terug op de regel als de AI faalt of ontbreekt', async () => {
    const { call, store } = setup([task(1, 'Erik bellen')], { estimator: async () => null });
    expect((await call('POST', '/estimate', { date: DAY })).json).toEqual({ estimated: 1, source: 'rule' });
    expect(store.get(id(1))!.metadata).toMatchObject({ estimate_min: 15, estimate_source: 'rule' });
  });

  it('feedback schuift de schatting een stap en maakt hem van jou', async () => {
    const { call, store } = setup([task(1, 'Rapport reviewen', { metadata: { estimate_min: 30 } })]);
    expect((await call('POST', '/feedback', { id: id(1), verdict: 'longer' })).json).toEqual({ estimate: 45 });
    expect(store.get(id(1))!.metadata).toMatchObject({ estimate_min: 45, estimate_source: 'user' });
  });

  it('de AI-schatter stuurt een genummerde lijst en rondt af op stappen', async () => {
    const parse = vi.fn(async () => ({ stop_reason: 'end_turn', parsed_output: { estimates: [{ n: 1, minutes: 37 }, { n: 2, minutes: 200 }] } }));
    const est = createEstimator({}, { messages: { parse } } as any)!;
    expect(await est(['Een', 'Twee'])).toEqual([30, 180]);
    expect((parse.mock.calls[0] as any)[0]).toMatchObject({ model: 'claude-opus-5-5', output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'Tasks:\n1. Een\n2. Twee' }] });
  });

  it('zonder sleutel geen AI-schatter', () => {
    expect(createEstimator({})).toBeNull();
  });
});

describe('dagplanning: avond en push', () => {
  it('sluit af met wat er af kwam en zet het restant op morgen', async () => {
    const { call, store } = setup([task(1, 'Klaar'), task(2, 'Niet klaar')]);
    await call('PUT', '/day', { date: DAY, planned: [id(1), id(2)], workMode: 'normal' });
    store.get(id(1))!.status = 'done';
    store.get(id(1))!.metadata.completed_at = '2026-11-16T15:00:00Z';
    const res = await call('POST', '/close', { date: DAY, moves: [{ id: id(2), to: 'tomorrow' }] });
    expect(res.json).toMatchObject({ done: 1, planned: 2, failed: [] });
    expect(store.get(id(2))).toMatchObject({ status: 'scheduled', metadata: { start_date: '2026-11-17' } });
  });

  it('ochtendpush zonder plan wordt een ingang naar het ritueel; avond telt het plan', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T07:00:00Z'));
    const { call, runtime, store } = setup([task(1, 'Klaar')]);
    const morning = await runtime.augmentDigest('morning', null, 'nl');
    expect(morning).toMatchObject({ body: 'Plan je dag — een minuut', url: '/#/dagplanning' });
    expect((await call('GET', '/startup')).json).toEqual({ open: true, date: DAY });

    await call('PUT', '/day', { date: DAY, planned: [id(1)], workMode: 'normal' });
    expect((await call('GET', '/startup')).json.open).toBe(false);
    const base = { title: 'Vandaag', body: '1 taak vandaag', url: '/#/today', tag: 'digest' };
    expect(await runtime.augmentDigest('morning', base, 'nl')).toEqual(base);

    store.get(id(1))!.status = 'done';
    store.get(id(1))!.metadata.completed_at = '2026-11-16T15:00:00Z';
    const evening = await runtime.augmentDigest('evening', null, 'nl');
    expect(evening).toMatchObject({ body: '1 van 1 gepland af · sluit je dag af', url: '/#/dagplanning' });
  });

  it('een uitgeschakelde module raakt de push niet aan', async () => {
    const { runtime, spies } = setup([], { enabled: false });
    expect(await runtime.augmentDigest('morning', null, 'nl')).toBeNull();
    expect(spies.listEntities).not.toHaveBeenCalled();
  });
});
