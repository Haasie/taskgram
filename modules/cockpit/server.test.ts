import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app.js';
import type { Config } from '../../server/config.js';
import { UpstreamError, type PostgramClient } from '../../server/postgram.js';
import { createModuleStore } from '../../server/modules/store.js';
import { MODULES } from '../../server/modules/discover.js';

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

function setup(where: PostgramClient['where']) {
  const moduleStore = createModuleStore(mkdtempSync(join(tmpdir(), 'tg-cockpit-')), MODULES);
  const pg = { where } as PostgramClient;
  const app = createApp(config, pg, { moduleStore });
  const call = (method: string, path: string, body?: unknown) =>
    app.request(`/api/modules${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { call };
}

describe('cockpit: werkplekken uit Postgram', () => {
  it('wordt gevonden, staat standaard uit en vraagt dan niets aan Postgram', async () => {
    const where = vi.fn();
    const { call } = setup(where);
    expect(MODULES.map((m) => m.id)).toContain('cockpit');
    expect((await (await call('GET', '')).json()).modules.cockpit).toBe(false);
    const res = await call('GET', '/cockpit/where');
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('MODULE_DISABLED');
    expect(where).not.toHaveBeenCalled();
  });

  it('geeft de instellingen door als query en de omgezette stand terug', async () => {
    const where = vi.fn(async () => ({
      generated_at: '2026-11-02T12:00:00Z',
      groups: [{ key: 'review', label: 'Review', features: [] }]
    }));
    const { call } = setup(where);
    await call('PUT', '/cockpit', { enabled: true });
    await call('PUT', '/cockpit/settings', { values: { actionsView: true, includeReleased: true, machine: ' laptop ' } });
    const body = await (await call('GET', '/cockpit/where')).json();
    expect(where).toHaveBeenCalledWith({ view: 'actions', include_released: true, machine: 'laptop' });
    expect(body).toEqual({ generatedAt: '2026-11-02T12:00:00Z', groups: [{ key: 'review', label: 'Review', features: [] }], unassigned: [] });
  });

  it('standaard: fase-weergave zonder filters', async () => {
    const where = vi.fn(async () => ({ groups: [] }));
    const { call } = setup(where);
    await call('PUT', '/cockpit', { enabled: true });
    await call('GET', '/cockpit/where');
    expect(where).toHaveBeenCalledWith({ view: 'stage', include_released: undefined, machine: undefined });
  });

  it('een Postgram zonder workspace-tracking geeft 404 door', async () => {
    const { call } = setup(vi.fn(async () => {
      throw new UpstreamError(404, 'NOT_FOUND', 'Not found');
    }));
    await call('PUT', '/cockpit', { enabled: true });
    const res = await call('GET', '/cockpit/where');
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });
});
