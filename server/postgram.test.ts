import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from './config.js';
import { createPostgramClient } from './postgram.js';

const config = { pgmApiUrl: 'http://pg.test', pgmApiKey: 'k' } as Config;
const entity = (id: string) => ({ id, type: 'task', content: id, visibility: 'personal', status: 'done', version: 1, tags: [], metadata: null, created_at: '', updated_at: '' });

function mockFetch() {
  const calls: { method: string; url: string }[] = [];
  let ids = ['a'];
  vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
    calls.push({ method: init.method ?? 'GET', url: String(url) });
    if (init.method === 'POST') {
      ids = [...ids, 'b'];
      return new Response(JSON.stringify({ entity: entity('b') }), { status: 200 });
    }
    return new Response(JSON.stringify({ items: ids.map(entity), total: ids.length }), { status: 200 });
  });
  const doneGets = () => calls.filter((c) => c.method === 'GET' && c.url.includes('status=done')).length;
  return { calls, doneGets };
}

afterEach(() => vi.unstubAllGlobals());

describe('gedeelde lijst afgeronde taken', () => {
  it('haalt hem één keer op voor gelijktijdige en snel opeenvolgende vragen', async () => {
    const f = mockFetch();
    const pg = createPostgramClient(config);
    await Promise.all([pg.listTasks('done'), pg.listTasks('done')]);
    await pg.listTasks('done');
    expect(f.doneGets()).toBe(1);
  });

  it('verloopt na de TTL', async () => {
    const f = mockFetch();
    let t = 0;
    const pg = createPostgramClient(config, { now: () => t, doneTtlMs: 1000 });
    await pg.listTasks('done');
    t = 1500;
    await pg.listTasks('done');
    expect(f.doneGets()).toBe(2);
  });

  it('een schrijfactie leegt de cache: een net afgevinkte taak telt direct mee', async () => {
    mockFetch();
    const pg = createPostgramClient(config);
    expect((await pg.listTasks('done')).map((e) => e.id)).toEqual(['a']);
    await pg.completeTask('b', 1);
    expect((await pg.listTasks('done')).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('andere statussen worden niet gecachet', async () => {
    const f = mockFetch();
    const pg = createPostgramClient(config);
    await pg.listTasks('next');
    await pg.listTasks('next');
    expect(f.calls.filter((c) => c.url.includes('status=next')).length).toBe(2);
  });
});
