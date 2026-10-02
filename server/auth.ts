import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import type { AuthConfig } from './auth/types.js';
import { readSession } from './auth/session.js';
import type { Config } from './config.js';

export type AuthEnv = { Variables: { user: string } };

export const safeEqual = (a: string, b: string) =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

const fingerprint = (value: string) => (value ? createHash('sha256').update(value).digest('hex').slice(0, 4) : '-');

/** Gebruiker uit een verzoek, of een reden waarom het verzoek geweigerd wordt. */
export function authenticate(
  c: Context,
  auth: AuthConfig
): { user: string } | { status: 401 | 403; reason: string } {
  switch (auth.mode) {
    case 'dev':
      return { user: 'dev' };

    case 'proxy': {
      // De proxy (bijv. Cosmos, Authelia) moet client-headers met dezelfde naam verwijderen en zelf zetten.
      // Het gedeelde geheim garandeert dat een verzoek dat de proxy omzeilt nooit geauthenticeerd is.
      const secret = c.req.header(auth.secretHeader) ?? '';
      if (!safeEqual(secret, auth.secret)) {
        console.warn(
          `[auth] proxy secret ${secret ? 'mismatch' : 'missing'}: got len=${secret.length} sha=${fingerprint(secret)}, ` +
            `expected len=${auth.secret.length} sha=${fingerprint(auth.secret)}, ` +
            `user-header=${c.req.header(auth.userHeader) ? 'present' : 'absent'}`
        );
        return { status: 401, reason: 'proxy-secret' };
      }
      const user = c.req.header(auth.userHeader)?.trim() ?? '';
      if (!user || !auth.allowedUsers.has(user)) {
        console.warn(`[auth] user not allowed: ${user ? JSON.stringify(user) : '(none)'}`);
        return { status: 403, reason: 'user-not-allowed' };
      }
      return { user };
    }

    case 'password':
    case 'oidc': {
      const user = readSession(c, auth.sessionSecret);
      return user ? { user } : { status: 401, reason: 'no-session' };
    }
  }
}

export function authMiddleware(config: Config): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const result = authenticate(c, config.auth);
    if ('user' in result) {
      c.set('user', result.user);
      return next();
    }
    return result.status === 401
      ? c.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401)
      : c.json({ error: { code: 'FORBIDDEN', message: 'User not allowed' } }, 403);
  };
}

/**
 * CSRF-bescherming voor muterende verzoeken: een custom header dwingt een CORS-preflight af
 * (die we niet toestaan) en de Origin moet, indien aanwezig, overeenkomen met de host.
 */
export const csrfMiddleware: MiddlewareHandler = async (c, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next();

  if (c.req.header('x-requested-with') !== 'taskgram') {
    return c.json({ error: { code: 'CSRF', message: 'Missing request header' } }, 403);
  }

  const origin = c.req.header('origin');
  if (origin) {
    const rawHost = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? '';
    const host = rawHost.split(',')[0]!.trim().replace(/:\d+$/, '').toLowerCase();
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).hostname.toLowerCase();
    } catch {
      originHost = null;
    }
    if (!host || originHost !== host) {
      return c.json({ error: { code: 'CSRF', message: 'Origin mismatch' } }, 403);
    }
  }

  return next();
};
