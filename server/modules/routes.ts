import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../auth.js';
import type { PostgramClient } from '../postgram.js';
import { MODULES, moduleById } from '../../modules/registry.js';
import type { ModuleStore } from './store.js';

/** Wat een module-server meekrijgt. `state` is per module gedeeld tussen routes en achtergrondtaak. */
export type ModuleContext = {
  pg: PostgramClient;
  /** Omgevingsvariabelen; een module leest alleen zijn eigen (bijv. KOSYNC_*). */
  env: Record<string, string | undefined>;
  timeZone: string;
  isEnabled: () => boolean;
  state: Record<string, unknown>;
};

export type ModuleServer = {
  routes: (ctx: ModuleContext) => Hono<AuthEnv>;
  /** Optionele achtergrondtaak; moet zelf `isEnabled()` controleren vóór elke data-call. */
  start?: (ctx: ModuleContext) => void;
};

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

export type ModuleDeps = { pg: PostgramClient; store: ModuleStore; env?: Record<string, string | undefined>; timeZone?: string };

/** Eén runtime per server: dezelfde context voor de API en de achtergrondtaken van een module. */
export function createModuleRuntime(deps: ModuleDeps) {
  const contexts = new Map<string, ModuleContext>(
    [...servers.keys()].map((id) => [
      id,
      { pg: deps.pg, env: deps.env ?? {}, timeZone: deps.timeZone ?? 'Europe/Amsterdam', isEnabled: () => deps.store.isEnabled(id), state: {} }
    ])
  );
  return {
    store: deps.store,
    contexts,
    /** Achtergrondtaken starten (alleen vanuit server/index.ts, niet in tests). */
    start() {
      for (const [id, server] of servers) server.start?.(contexts.get(id)!);
    }
  };
}
export type ModuleRuntime = ReturnType<typeof createModuleRuntime>;

export function createModuleRoutes(runtime: ModuleRuntime) {
  const routes = new Hono<AuthEnv>();
  const store = runtime.store;

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

  for (const [id, server] of servers) routes.route(`/${id}`, server.routes(runtime.contexts.get(id)!));

  return routes;
}
