import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import type { Config } from '../config.js';
import type { PostgramClient, RawEntity } from '../postgram.js';
import { createModuleStore } from './store.js';

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

const BOOK_ID = '11111111-1111-4111-8111-111111111111';
const NOTE_ID = '22222222-2222-4222-8222-222222222222';
const entity = (over: Partial<RawEntity>): RawEntity => ({
  id: BOOK_ID,
  type: 'document',
  content: 'Zuid — Ernest Shackleton',
  visibility: 'personal',
  status: null,
  version: 3,
  tags: ['book'],
  metadata: { title: 'Zuid', author: 'Ernest Shackleton', status: 'te-lezen', cat: 'reis' },
  created_at: '',
  updated_at: '',
  ...over
});

function setup(moduleEnv: Record<string, string> = {}) {
  const pg = {
    listEntities: vi.fn(async () => [entity({})]),
    getEntity: vi.fn(async (id: string) => (id === BOOK_ID ? entity({}) : entity({ id, tags: [] }))),
    createEntity: vi.fn(async (body: Partial<RawEntity>) => entity({ ...body, id: BOOK_ID, version: 1 })),
    updateEntity: vi.fn(async (_id: string, body: { metadata?: Record<string, unknown> }) =>
      entity({ version: 4, metadata: { ...entity({}).metadata, ...body.metadata } })
    ),
    deleteEntity: vi.fn(async () => ({}))
  };
  const moduleStore = createModuleStore(mkdtempSync(join(tmpdir(), 'tg-modules-')));
  const app = createApp(config, pg as unknown as PostgramClient, { moduleStore, moduleEnv });
  const call = (method: string, path: string, body?: unknown) =>
    app.request(`/api/modules${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { pg, call };
}

describe('modules', () => {
  it('staan standaard uit en de API weigert dan zonder Postgram te raken', async () => {
    const { pg, call } = setup();
    expect(await (await call('GET', '')).json()).toEqual({ modules: { leesdossier: false, werkradar: true, priveradar: true } });
    const res = await call('GET', '/leesdossier/books');
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('MODULE_DISABLED');
    expect(pg.listEntities).not.toHaveBeenCalled();
  });

  it('modules zonder server.ts (radars) hebben geen module-API', async () => {
    const { call } = setup();
    expect((await call('GET', '/werkradar/anything')).status).toBe(404);
    await call('PUT', '/werkradar', { enabled: false });
    expect(await (await call('GET', '')).json()).toEqual({ modules: { leesdossier: false, werkradar: false, priveradar: true } });
  });

  it('bewaart de schakelaar en weigert onbekende modules', async () => {
    const { call } = setup();
    expect(await (await call('PUT', '/leesdossier', { enabled: true })).json()).toEqual({ modules: { leesdossier: true, werkradar: true, priveradar: true } });
    expect(await (await call('GET', '')).json()).toEqual({ modules: { leesdossier: true, werkradar: true, priveradar: true } });
    expect((await call('PUT', '/bestaat-niet', { enabled: true })).status).toBe(404);
    expect((await call('PUT', '/leesdossier', { enabled: 'ja' })).status).toBe(400);
  });

  it('leesdossier: lijst, aanmaken, bijwerken en verwijderen via Postgram', async () => {
    const { pg, call } = setup();
    await call('PUT', '/leesdossier', { enabled: true });

    const list = await (await call('GET', '/leesdossier/books')).json();
    expect(pg.listEntities).toHaveBeenCalledWith('document', ['book']);
    expect(list.items[0]).toMatchObject({ id: BOOK_ID, title: 'Zuid', status: 'te-lezen', cat: 'reis', order: 0 });

    const created = await call('POST', '/leesdossier/books', { title: 'Borne', author: 'Jeff VanderMeer', cat: 'fic' });
    expect(created.status).toBe(201);
    expect(pg.createEntity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'document', tags: ['book'], content: 'Borne — Jeff VanderMeer', metadata: expect.objectContaining({ title: 'Borne', status: 'te-lezen', rating: 0 }) })
    );

    const patched = await call('PATCH', `/leesdossier/books/${BOOK_ID}`, { version: 3, order: 2, note: 'Endurance' });
    expect((await patched.json()).book).toMatchObject({ order: 2, version: 4 });
    expect(pg.updateEntity).toHaveBeenCalledWith(BOOK_ID, { version: 3, content: 'Zuid — Ernest Shackleton\n\nEndurance', metadata: { order: 2, note: 'Endurance' } });

    expect((await call('DELETE', `/leesdossier/books/${BOOK_ID}`)).status).toBe(200);
    expect(pg.deleteEntity).toHaveBeenCalledWith(BOOK_ID);
  });

  it('leesdossier: raakt geen entities aan die geen boek zijn en valideert invoer', async () => {
    const { pg, call } = setup();
    await call('PUT', '/leesdossier', { enabled: true });
    expect((await call('DELETE', `/leesdossier/books/${NOTE_ID}`)).status).toBe(404);
    expect((await call('PATCH', `/leesdossier/books/${BOOK_ID}`, { version: 3, rating: 9 })).status).toBe(400);
    expect((await call('PATCH', `/leesdossier/books/${BOOK_ID}`, { version: 3, status: 'actief' })).status).toBe(400);
    expect((await call('POST', '/leesdossier/books', { author: 'zonder titel' })).status).toBe(400);
    expect(pg.deleteEntity).not.toHaveBeenCalled();
    expect(pg.updateEntity).not.toHaveBeenCalled();
  });
});

describe('leesdossier: KOReader-sync', () => {
  afterEach(() => vi.unstubAllGlobals());
  const env = { KOSYNC_URL: 'https://kosync.example/', KOSYNC_USER: 'lezer', KOSYNC_PASSWORD: 'geheim' };
  const doc = { document: 'd6abb38b', percentage: 0.54, timestamp: 1793231549, device: 'PBTouchHDPlus', title: 'Zuid: De Endurance-expeditie', authors: 'Ernest Shackleton', filename: null };
  const unknown = { document: 'ffff0000', percentage: 0.1, timestamp: 1793231549, device: 'PB', title: 'Onbekend boek', authors: 'A; B', filename: null };

  function stubKosync(documents: unknown[], status = 200) {
    const fetchMock = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      expect(url).toBe('https://kosync.example/syncs/documents');
      expect(init.headers['x-auth-user']).toBe('lezer');
      expect(init.headers['x-auth-key']).toBe(createHash('md5').update('geheim').digest('hex'));
      return new Response(JSON.stringify({ documents }), { status, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('meldt niet-geconfigureerd zonder KOSYNC_* en raakt kosync dan niet', async () => {
    const { call } = setup();
    await call('PUT', '/leesdossier', { enabled: true });
    const fetchMock = stubKosync([]);
    expect(await (await call('GET', '/leesdossier/kosync')).json()).toEqual({ configured: false, last: null });
    expect((await call('POST', '/leesdossier/kosync/sync')).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('synct voortgang naar het gekoppelde boek en houdt onbekende documenten apart', async () => {
    const { pg, call } = setup(env);
    await call('PUT', '/leesdossier', { enabled: true });
    stubKosync([doc, unknown]);
    const { last } = await (await call('POST', '/leesdossier/kosync/sync')).json();
    expect(last).toMatchObject({ ok: true, documents: 2, updated: ['Zuid'] });
    expect(last.unmatched.map((d: { document: string }) => d.document)).toEqual(['ffff0000']);
    expect(pg.updateEntity).toHaveBeenCalledWith(BOOK_ID, expect.objectContaining({
      version: 3,
      metadata: expect.objectContaining({ status: 'lezend', progress: 54, kosync_document: 'd6abb38b', kosync_at: 1793231549 })
    }));
    expect((await (await call('GET', '/leesdossier/kosync')).json()).last.updated).toEqual(['Zuid']);
  });

  it('voegt een onbekend document toe als gekoppeld boek', async () => {
    const { pg, call } = setup(env);
    await call('PUT', '/leesdossier', { enabled: true });
    stubKosync([unknown]);
    const res = await call('POST', '/leesdossier/kosync/adopt/ffff0000', { cat: 'fic' });
    expect(res.status).toBe(201);
    expect(pg.createEntity).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ title: 'Onbekend boek', author: 'A, B', cat: 'fic' }) }));
    expect(pg.updateEntity).toHaveBeenCalledWith(BOOK_ID, expect.objectContaining({ metadata: expect.objectContaining({ kosync_document: 'ffff0000', progress: 10 }) }));
  });

  it('rapporteert een afgewezen login zonder te crashen, en weigert als de module uit staat', async () => {
    const { call } = setup(env);
    await call('PUT', '/leesdossier', { enabled: true });
    stubKosync([], 401);
    const { last } = await (await call('POST', '/leesdossier/kosync/sync')).json();
    expect(last).toMatchObject({ ok: false, error: 'KOReader sync server rejected the credentials' });
    await call('PUT', '/leesdossier', { enabled: false });
    expect((await call('POST', '/leesdossier/kosync/sync')).status).toBe(404);
  });
});
