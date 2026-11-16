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
import type { CalendarSource } from '../../server/calendar.js';

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

function setup(
  seed: RawEntity[],
  opts: { enabled?: boolean; estimator?: (titles: string[]) => Promise<number[] | null>; calendar?: CalendarSource | null } = {}
) {
  const { pg, store, spies } = fakePg(seed);
  const moduleStore = createModuleStore(mkdtempSync(join(tmpdir(), 'tg-dagplanning-')), MODULES);
  if (opts.enabled !== false) moduleStore.setEnabled('dagplanning', true);
  const runtime = createModuleRuntime({ pg, store: moduleStore, env: {}, timeZone: 'Europe/Amsterdam', calendar: opts.calendar ?? null });
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

describe('dagplanning: privé-agenda', () => {
  const source = (occurrences: { title: string; start: string; end: string; allDay?: boolean }[], failed = 0): CalendarSource => ({
    feeds: 1,
    between: async () => ({
      occurrences: occurrences.map((o, i) => ({ uid: `u${i}`, title: o.title, allDay: o.allDay ?? false, start: Date.parse(o.start), end: Date.parse(o.end), calendar: 'Gezin' })),
      failed,
      total: 1
    })
  });

  it('toont de afspraken van vandaag en haalt hun tijd van de capaciteit af', async () => {
    const { call } = setup([task(1, 'Erik bellen')], {
      calendar: source([
        { title: 'Tandarts', start: '2026-11-16T09:00:00Z', end: '2026-11-16T10:00:00Z' },
        { title: 'Zwemles', start: '2026-11-16T17:30:00Z', end: '2026-11-16T18:15:00Z' },
        { title: 'Gisteren', start: '2026-11-15T09:00:00Z', end: '2026-11-15T10:00:00Z' }
      ])
    });
    const { json } = await call('GET', `/day?date=${DAY}`);
    expect(json.agenda.items).toEqual([
      { title: 'Tandarts', calendar: 'Gezin', allDay: false, start: '10:00', end: '11:00' },
      { title: 'Zwemles', calendar: 'Gezin', allDay: false, start: '18:30', end: '19:15' }
    ]);
    expect(json.agenda.busy).toEqual({ work: 60, personal: 45 });
    expect(json.settings.capacity.normal).toEqual({ work: 240, personal: 45 });
  });

  it('zonder agenda of als hij wegvalt, rekent de planning gewoon zonder', async () => {
    const none = await setup([task(1, 'Erik bellen')]).call('GET', `/day?date=${DAY}`);
    expect(none.json.agenda).toMatchObject({ configured: false, items: [] });
    const broken: CalendarSource = { feeds: 1, between: async () => { throw new Error('weg'); } };
    const down = await setup([task(1, 'Erik bellen')], { calendar: broken }).call('GET', `/day?date=${DAY}`);
    expect(down.json.agenda).toMatchObject({ configured: true, failed: 1, busy: { work: 0, personal: 0 } });
    expect(down.json.settings.capacity.normal).toEqual({ work: 300, personal: 90 });
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

describe('dagplanning: afvinken', () => {
  const finish = (store: Map<string, RawEntity>, n: number, at = '2026-11-16T10:00:00Z') => {
    const e = store.get(id(n))!;
    e.status = 'done';
    e.version += 1;
    e.metadata = { ...e.metadata, completed_at: at };
  };

  it('een geplande taak die wordt afgevinkt blijft in het plan, telt als af en niet meer als belasting', async () => {
    const { call, store } = setup([task(1, 'Klaar', { metadata: { estimate_min: 60 } }), task(2, 'Nog bezig', { metadata: { estimate_min: 30 } })]);
    await call('PUT', '/day', { date: DAY, planned: [id(1), id(2)], workMode: 'normal' });
    const before = (await call('GET', `/day?date=${DAY}`)).json;
    finish(store, 1);
    const after = (await call('GET', `/day?date=${DAY}`)).json;
    expect(after.plan.planned).toEqual([id(1), id(2)]);
    expect(after.plan.done).toEqual([id(1)]);
    expect(after.planned.map((t: any) => [t.id, t.status])).toEqual([[id(1), 'done'], [id(2), 'next']]);
    expect(after.today.map((t: any) => t.id)).toEqual([id(2)]);
    expect(after.load.items.map((i: any) => i.id)).toEqual([id(2)]);
    expect(after.load.buckets.work.load).toBeLessThan(before.load.buckets.work.load);
  });

  it('heropenen haalt de taak weer uit "af" en terug in de belasting', async () => {
    const { call, store } = setup([task(1, 'Klaar', { metadata: { estimate_min: 60 } })]);
    await call('PUT', '/day', { date: DAY, planned: [id(1)], workMode: 'normal' });
    finish(store, 1);
    expect((await call('GET', `/day?date=${DAY}`)).json.plan.done).toEqual([id(1)]);
    store.get(id(1))!.status = 'next';
    store.get(id(1))!.metadata = { ...store.get(id(1))!.metadata, completed_at: null };
    const view = (await call('GET', `/day?date=${DAY}`)).json;
    expect(view.plan.done).toEqual([]);
    expect(view.today.map((t: any) => t.id)).toEqual([id(1)]);
    expect(view.load.items.map((i: any) => i.id)).toEqual([id(1)]);
  });

  it('zonder opgeslagen plan maakt afvinken niets kapot: geen plan, de taak is gewoon weg uit de lijsten', async () => {
    const { call, store } = setup([task(1, 'Klaar'), task(2, 'Nog bezig')]);
    finish(store, 1);
    const view = (await call('GET', `/day?date=${DAY}`)).json;
    expect(view.plan).toBeNull();
    expect(view.today.map((t: any) => t.id)).toEqual([id(2)]);
    expect(view.suggested).toEqual([id(2)]);
    expect(view.planned.map((t: any) => t.id)).toEqual([id(2)]);
    // Daarna plannen met de vandaag afgeronde taak erbij: hij komt in het plan en telt 's avonds als af.
    const saved = await call('PUT', '/day', { date: DAY, planned: [id(1), id(2)], workMode: 'normal' });
    expect(saved.status).toBe(200);
    expect(saved.json.plan.planned).toEqual([id(1), id(2)]);
  });

  it('herhalende taak: de afgeronde rij en de opvolger zijn twee aparte taken, elk één keer', async () => {
    const { call, store } = setup([task(1, 'Wekelijks', { metadata: { estimate_min: 30 } })]);
    await call('PUT', '/day', { date: DAY, planned: [id(1)], workMode: 'normal' });
    finish(store, 1);
    // Zoals de core-route: de opvolger start later, dus niet vandaag.
    store.set(id(9), task(9, 'Wekelijks', { status: 'scheduled', metadata: { start_date: '2026-11-23', recurrence_parent_id: id(1) } }));
    const view = (await call('GET', `/day?date=${DAY}`)).json;
    expect(view.plan.done).toEqual([id(1)]);
    expect(view.planned.map((t: any) => t.id)).toEqual([id(1)]);
    const ids = [...view.leftovers, ...view.today, ...view.extra, ...view.planned].map((t: any) => t.id);
    expect(ids).not.toContain(id(9));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('een taak die gisteren af kwam telt niet als af vandaag', async () => {
    const { call, store } = setup([task(1, 'Klaar')]);
    await call('PUT', '/day', { date: DAY, planned: [id(1)], workMode: 'normal' });
    finish(store, 1, '2026-11-15T10:00:00Z');
    expect((await call('GET', `/day?date=${DAY}`)).json.plan.done).toEqual([]);
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

  it('zonder AI schrijft de regel de schatting weg', async () => {
    const { call, store } = setup([task(1, 'Erik bellen')]);
    expect((await call('POST', '/estimate', { date: DAY })).json).toEqual({ estimated: 1, source: 'rule' });
    expect(store.get(id(1))!.metadata).toMatchObject({ estimate_min: 15, estimate_source: 'rule' });
  });

  it('een mislukte AI-ronde schrijft niets weg en probeert het pas na de afkoeltijd opnieuw', async () => {
    const estimator = vi.fn(async (): Promise<number[] | null> => null);
    const { call, store } = setup([task(1, 'Erik bellen')], { estimator });
    expect((await call('POST', '/estimate', { date: DAY })).json).toEqual({ estimated: 0, source: null });
    expect(store.get(id(1))!.metadata.estimate_min).toBeUndefined();
    // De regel geldt wel bij het tonen, en de taak telt nog als 'mist een schatting'.
    const view = (await call('GET', `/day?date=${DAY}`)).json;
    expect(view.missingEstimates).toBe(1);
    await call('POST', '/estimate', { date: DAY });
    expect(estimator).toHaveBeenCalledTimes(1);
  });

  it('een weggeschreven regel-schatting van een eerdere mislukte ronde krijgt alsnog een AI-schatting', async () => {
    const estimator = vi.fn(async (titles: string[]) => titles.map(() => 90));
    const { call, store } = setup([task(1, 'Rapport schrijven', { metadata: { estimate_min: 45, estimate_source: 'rule' } }), task(2, 'Van mij', { metadata: { estimate_min: 30, estimate_source: 'user' } })], { estimator });
    expect((await call('GET', `/day?date=${DAY}`)).json.missingEstimates).toBe(1);
    expect((await call('POST', '/estimate', { date: DAY })).json).toEqual({ estimated: 1, source: 'ai' });
    expect(store.get(id(1))!.metadata).toMatchObject({ estimate_min: 90, estimate_source: 'ai' });
    expect(store.get(id(2))!.metadata).toMatchObject({ estimate_min: 30, estimate_source: 'user' });
  });

  it('de schatter probeert het na een 429 één keer opnieuw en geeft daarna pas op', async () => {
    const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ estimates: [{ n: 1, minutes: 30 }] }) } }] }), { status: 200 });
    const busy = () => new Response(JSON.stringify({ type: 'service_tier_capacity_exceeded', message: 'niet loggen' }), { status: 429 });
    const once = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(ok());
    expect(await createEstimator({ MISTRAL_API_KEY: 'k' }, once as unknown as typeof fetch, 0)!(['Een'])).toEqual([30]);
    expect(once).toHaveBeenCalledTimes(2);

    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const twice = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy());
    expect(await createEstimator({ MISTRAL_API_KEY: 'k' }, twice as unknown as typeof fetch, 0)!(['Een'])).toBeNull();
    expect(twice).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith('[dagplanning] schatten mislukt: HTTP 429 (service_tier_capacity_exceeded)');
    log.mockRestore();
  });

  it('feedback schuift de schatting een stap en maakt hem van jou', async () => {
    const { call, store } = setup([task(1, 'Rapport reviewen', { metadata: { estimate_min: 30 } })]);
    expect((await call('POST', '/feedback', { id: id(1), verdict: 'longer' })).json).toEqual({ estimate: 45 });
    expect(store.get(id(1))!.metadata).toMatchObject({ estimate_min: 45, estimate_source: 'user' });
  });

  it('de Mistral-schatter stuurt een genummerde lijst in JSON-modus en rondt af op stappen', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ estimates: [{ n: 1, minutes: 37 }, { n: 2, minutes: 200 }] }) } }] }), { status: 200 })
    );
    const est = createEstimator({ MISTRAL_API_KEY: 'k' }, fetchImpl as unknown as typeof fetch)!;
    expect(await est(['Een', 'Twee'])).toEqual([30, 180]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.mistral.ai/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: 'mistral-small-latest', response_format: { type: 'json_object' } });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Tasks:\n1. Een\n2. Twee' });
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
  });

  it('de Mistral-schatter geeft null bij een fout of onzin, zodat de regel het overneemt', async () => {
    const down = createEstimator({ MISTRAL_API_KEY: 'k' }, (async () => new Response('{}', { status: 503 })) as unknown as typeof fetch)!;
    expect(await down(['Een'])).toBeNull();
    const junk = createEstimator({ MISTRAL_API_KEY: 'k' }, (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'geen json' } }] }), { status: 200 })) as unknown as typeof fetch)!;
    expect(await junk(['Een'])).toBeNull();
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

describe('dagplanning: afgevinkt vóór het vastleggen', () => {
  it('een taak die vandaag al af is en in de selectie zit, komt in het plan en telt als af', async () => {
    const { call, store } = setup([task(1, 'Al klaar', { metadata: { estimate_min: 60 } }), task(2, 'Nog open', { metadata: { estimate_min: 30 } })]);
    const e = store.get(id(1))!;
    e.status = 'done';
    e.version += 1;
    e.metadata = { ...e.metadata, completed_at: '2026-11-16T08:00:00Z' };
    const saved = await call('PUT', '/day', { date: DAY, planned: [id(1), id(2)], workMode: 'normal' });
    expect(saved.json.plan.planned).toEqual([id(1), id(2)]);
    const view = (await call('GET', `/day?date=${DAY}`)).json;
    expect(view.plan.done).toEqual([id(1)]);
    expect(view.load.items.map((i: { id: string }) => i.id)).toEqual([id(2)]);
  });

  it('een taak die op een andere dag af kwam, komt niet in het plan', async () => {
    const { call, store } = setup([task(1, 'Vorige week klaar'), task(2, 'Nog open')]);
    const e = store.get(id(1))!;
    e.status = 'done';
    e.metadata = { ...e.metadata, completed_at: '2026-11-10T08:00:00Z' };
    const saved = await call('PUT', '/day', { date: DAY, planned: [id(1), id(2)], workMode: 'normal' });
    expect(saved.json.plan.planned).toEqual([id(2)]);
  });
});
