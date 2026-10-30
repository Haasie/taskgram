import { Hono } from 'hono';
import type { AuthEnv } from '../../server/auth.js';
import type { ModuleContext } from '../../server/modules/routes.js';
import { UpstreamError } from '../../server/postgram.js';
import { fromSupervisor } from './status.js';

/**
 * Leest /api/status van de Homelab Supervisor (SUPERVISOR_URL + SUPERVISOR_TOKEN).
 * Het token blijft op de server; de browser krijgt alleen de omgezette status.
 */
export function routes(ctx: ModuleContext) {
  const api = new Hono<AuthEnv>();
  const url = ctx.env.SUPERVISOR_URL?.trim().replace(/\/$/, '');
  const token = ctx.env.SUPERVISOR_TOKEN?.trim();

  api.get('/status', async (c) => {
    if (!url) return c.json({ configured: false, status: null });
    let res: Response;
    try {
      res = await fetch(`${url}/api/status`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(10_000)
      });
    } catch {
      throw new UpstreamError(502, 'SUPERVISOR_UNAVAILABLE', 'Homelab Supervisor is unavailable');
    }
    if (res.status === 401) throw new UpstreamError(502, 'SUPERVISOR_AUTH', 'Homelab Supervisor rejected the token');
    if (!res.ok) throw new UpstreamError(502, 'SUPERVISOR_ERROR', `Homelab Supervisor responded with ${res.status}`);
    return c.json({ configured: true, status: fromSupervisor(await res.json().catch(() => ({}))) });
  });

  return api;
}
