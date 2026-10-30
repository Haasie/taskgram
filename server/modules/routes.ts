import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../auth.js';
import type { PostgramClient } from '../postgram.js';
import { MODULES, moduleById } from '../../modules/registry.js';
import type { ModuleStore } from './store.js';

export type ModuleServer = { routes: (pg: PostgramClient) => Hono<AuthEnv> };

// Serverdeel per module laden volgens de mapconventie; modules zonder server.ts hebben geen API.
const servers = new Map<string, ModuleServer>();
for (const m of MODULES) {
  const path = `../../modules/${m.id}/server.js`;
  try {
    servers.set(m.id, (await import(/* @vite-ignore */ path)) as ModuleServer);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== 'ERR_MODULE_NOT_FOUND' && !/Cannot find module|Failed to load url/.test(String(err))) throw err;
  }
}

const toggleBody = z.object({ enabled: z.boolean() }).strict();

const disabled = (c: { json: (body: unknown, status: 404) => Response }) =>
  c.json({ error: { code: 'MODULE_DISABLED', message: 'Module is disabled' } }, 404);

export function createModuleRoutes(pg: PostgramClient, store: ModuleStore) {
  const routes = new Hono<AuthEnv>();

  routes.get('/', (c) => c.json({ modules: store.states() }));

  routes.put('/:id', async (c) => {
    const id = c.req.param('id');
    if (!moduleById(id)) return c.json({ error: { code: 'NOT_FOUND', message: 'Unknown module' } }, 404);
    const body = toggleBody.parse(await c.req.json());
    return c.json({ modules: store.setEnabled(id, body.enabled) });
  });

  // Uitgeschakeld = geen data-calls: elke module-API valt hier af vóór er iets naar Postgram gaat.
  routes.use('/:id/*', async (c, next) => {
    if (!store.isEnabled(c.req.param('id'))) return disabled(c);
    await next();
  });

  for (const [id, server] of servers) routes.route(`/${id}`, server.routes(pg));

  return routes;
}
