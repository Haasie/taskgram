import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../auth.js';
import type { PostgramClient } from '../postgram.js';
import { validateSettings } from '../../modules/settings.js';
import type { ModuleSettings } from '../../modules/types.js';
import { MODULES_WITH_SERVER, moduleById } from './discover.js';
import type { ModuleStore } from './store.js';

/** Wat een module-server meekrijgt. `state` is per module gedeeld tussen routes en achtergrondtaak. */
export type ModuleContext = {
  pg: PostgramClient;
  /** Omgevingsvariabelen; een module leest alleen zijn eigen (bijv. KOSYNC_*). */
  env: Record<string, string | undefined>;
  timeZone: string;
  isEnabled: () => boolean;
  /** Actuele instellingen van deze module (standaardwaarden ingevuld). */
  settings: () => ModuleSettings;
  state: Record<string, unknown>;
};

export type ModuleServer = {
  routes: (ctx: ModuleContext) => Hono<AuthEnv>;
  /** Optionele achtergrondtaak; moet zelf `isEnabled()` controleren vóór elke data-call. */
  start?: (ctx: ModuleContext) => void;
};

// Serverdeel per module laden volgens de mapconventie; modules zonder server.ts hebben geen API.
const servers = new Map<string, ModuleServer>();
for (const id of MODULES_WITH_SERVER) {
  servers.set(id, (await import(/* @vite-ignore */ `../../modules/${id}/server.js`)) as ModuleServer);
}

const toggleBody = z.object({ enabled: z.boolean() }).strict();
const settingsBody = z.object({ values: z.record(z.string(), z.unknown()).default({}), reset: z.array(z.string()).default([]) }).strict();

const disabled = (c: { json: (body: unknown, status: 404) => Response }) =>
  c.json({ error: { code: 'MODULE_DISABLED', message: 'Module is disabled' } }, 404);

export type ModuleDeps = { pg: PostgramClient; store: ModuleStore; env?: Record<string, string | undefined>; timeZone?: string };

/** Eén runtime per server: dezelfde context voor de API en de achtergrondtaken van een module. */
export function createModuleRuntime(deps: ModuleDeps) {
  const contexts = new Map<string, ModuleContext>(
    [...servers.keys()].map((id) => [
      id,
      {
        pg: deps.pg,
        env: deps.env ?? {},
        timeZone: deps.timeZone ?? 'Europe/Amsterdam',
        isEnabled: () => deps.store.isEnabled(id),
        settings: () => deps.store.settings(id),
        state: {}
      }
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

  routes.get('/', (c) => c.json({ modules: store.states(), settings: store.allSettings() }));

  routes.put('/:id', async (c) => {
    const id = c.req.param('id');
    if (!moduleById(id)) return c.json({ error: { code: 'NOT_FOUND', message: 'Unknown module' } }, 404);
    const body = toggleBody.parse(await c.req.json());
    return c.json({ modules: store.setEnabled(id, body.enabled) });
  });

  // Instellingen kunnen ook gewijzigd worden als de module uit staat (eerst instellen, dan aanzetten).
  routes.put('/:id/settings', async (c) => {
    const id = c.req.param('id');
    const manifest = moduleById(id);
    if (!manifest) return c.json({ error: { code: 'NOT_FOUND', message: 'Unknown module' } }, 404);
    const body = settingsBody.parse(await c.req.json());
    const known = new Set((manifest.settings ?? []).map((d) => d.key));
    const badReset = body.reset.filter((k) => !known.has(k));
    const checked = validateSettings(manifest.settings, body.values);
    if (!checked.ok || badReset.length) {
      const issues = { ...(checked.ok ? {} : checked.errors), ...Object.fromEntries(badReset.map((k) => [k, 'onbekende instelling'])) };
      return c.json({ error: { code: 'VALIDATION', message: 'Invalid settings', issues } }, 400);
    }
    return c.json({ settings: store.setSettings(id, checked.values, body.reset) });
  });

  // Uitgeschakeld = geen data-calls: elke module-API valt hier af vóór er iets naar Postgram gaat.
  routes.use('/:id/*', async (c, next) => {
    if (c.req.path.endsWith('/settings') && c.req.method === 'PUT') return next();
    if (!store.isEnabled(c.req.param('id'))) return disabled(c);
    await next();
  });

  for (const [id, server] of servers) routes.route(`/${id}`, server.routes(runtime.contexts.get(id)!));

  return routes;
}
