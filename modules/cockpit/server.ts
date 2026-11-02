import { Hono } from 'hono';
import type { AuthEnv } from '../../server/auth.js';
import type { ModuleContext } from '../../server/modules/routes.js';
import { toCockpit } from './logic.js';

/**
 * Leest `GET /api/where` van Postgram (workspace- en sessie-tracking) en geeft een ingekorte versie door:
 * fasen, features, werkplekken en risico's, zonder transcript-paden.
 */
export function routes(ctx: ModuleContext) {
  const api = new Hono<AuthEnv>();

  api.get('/where', async (c) => {
    const s = ctx.settings();
    const machine = String(s.machine ?? '').trim();
    const raw = await ctx.pg.where({
      view: s.actionsView ? 'actions' : 'stage',
      include_released: s.includeReleased ? true : undefined,
      machine: machine || undefined
    });
    return c.json(toCockpit(raw));
  });

  return api;
}
