import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import * as client from 'openid-client';
import { z } from 'zod';
import { authenticate, safeEqual } from '../auth.js';
import type { Config } from '../config.js';
import { verifyPassword } from './password.js';
import { createRateLimiter } from './ratelimit.js';
import { clearSession, isSecureRequest, seal, unseal, writeSession } from './session.js';
import type { OidcAuth, PasswordAuth } from './types.js';

const loginBody = z.object({ username: z.string().min(1).max(200), password: z.string().min(1).max(500) }).strict();

const OIDC_COOKIE = 'taskgram_oidc';

function clientKey(c: Context, trustProxy: boolean) {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Publieke auth-endpoints (vóór de auth-middleware):
 * - GET  /api/auth/config  — welke loginmethode en of er een geldige sessie is
 * - POST /api/auth/login   — wachtwoordlogin
 * - POST /api/auth/logout  — sessie beëindigen
 */
export function createAuthApiRoutes(config: Config, opts: { now?: () => number } = {}) {
  const api = new Hono();
  const auth = config.auth;
  const limiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000, ...(opts.now ? { now: opts.now } : {}) });

  api.get('/config', (c) => {
    const result = authenticate(c, auth);
    return c.json({
      mode: auth.mode,
      user: 'user' in result ? result.user : null,
      loginUrl: auth.mode === 'proxy' ? auth.loginPath : auth.mode === 'oidc' ? '/auth/oidc/login' : null
    });
  });

  api.post('/login', async (c) => {
    if (auth.mode !== 'password') {
      return c.json({ error: { code: 'NOT_SUPPORTED', message: 'Password login is not enabled' } }, 400);
    }
    const key = clientKey(c, auth.trustProxy);
    const wait = limiter.blockedFor(key);
    if (wait > 0) {
      c.header('retry-after', String(wait));
      return c.json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts', retryAfter: wait } }, 429);
    }
    const body = loginBody.parse(await c.req.json());
    if (!(await checkPassword(auth, body.username, body.password))) {
      limiter.fail(key);
      console.warn(`[auth] failed login for ${JSON.stringify(body.username.slice(0, 50))}`);
      return c.json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } }, 401);
    }
    limiter.reset(key);
    writeSession(c, auth.username, auth.sessionSecret, auth.sessionDays);
    return c.json({ user: auth.username });
  });

  api.post('/logout', (c) => {
    clearSession(c);
    return c.json({ ok: true });
  });

  return api;
}

async function checkPassword(auth: PasswordAuth, username: string, password: string) {
  // Altijd de wachtwoordcontrole uitvoeren, zodat de responstijd niet verraadt of de gebruikersnaam klopt.
  const passwordOk = auth.passwordHash
    ? await verifyPassword(password, auth.passwordHash)
    : safeEqual(password, auth.passwordPlain ?? '');
  return safeEqual(username, auth.username) && passwordOk;
}

type OidcState = { v: string; s: string; n: string; exp: number };

/** OIDC authorization-code flow met PKCE, state en nonce: GET /auth/oidc/login en /auth/oidc/callback. */
export function createOidcRoutes(auth: OidcAuth, opts: { discover?: () => Promise<client.Configuration> } = {}) {
  const app = new Hono();
  let configuration: Promise<client.Configuration> | null = null;

  const discover =
    opts.discover ??
    (async () => {
      const issuer = new URL(auth.issuer);
      const cfg = await client.discovery(
        issuer,
        auth.clientId,
        undefined,
        auth.clientSecret ? client.ClientSecretPost(auth.clientSecret) : client.None()
      );
      if (issuer.protocol === 'http:') client.allowInsecureRequests(cfg);
      return cfg;
    });

  const getConfiguration = () => {
    configuration ??= discover().catch((err) => {
      configuration = null;
      throw err;
    });
    return configuration;
  };

  app.get('/login', async (c) => {
    const cfg = await getConfiguration();
    const verifier = client.randomPKCECodeVerifier();
    const state: OidcState = {
      v: verifier,
      s: client.randomState(),
      n: client.randomNonce(),
      exp: Date.now() + 10 * 60 * 1000
    };
    setCookie(c, OIDC_COOKIE, seal(state, auth.sessionSecret), {
      httpOnly: true,
      secure: isSecureRequest(c),
      sameSite: 'Lax',
      path: '/auth/oidc',
      maxAge: 600
    });
    const url = client.buildAuthorizationUrl(cfg, {
      redirect_uri: auth.redirectUrl,
      scope: auth.scopes,
      code_challenge: await client.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state: state.s,
      nonce: state.n
    });
    return c.redirect(url.toString(), 302);
  });

  app.get('/callback', async (c) => {
    const state = unseal<OidcState>(getCookie(c, OIDC_COOKIE), auth.sessionSecret);
    deleteCookie(c, OIDC_COOKIE, { path: '/auth/oidc', secure: isSecureRequest(c) });
    if (!state || state.exp < Date.now()) return c.text('Login expired, please try again.', 400);

    const cfg = await getConfiguration();
    // De callback-URL moet exact overeenkomen met redirect_uri; neem alleen de querystring van het verzoek over.
    const current = new URL(auth.redirectUrl);
    current.search = new URL(c.req.url).search;

    let claims: Record<string, unknown> | undefined;
    try {
      const tokens = await client.authorizationCodeGrant(cfg, current, {
        pkceCodeVerifier: state.v,
        expectedState: state.s,
        expectedNonce: state.n,
        idTokenExpected: true
      });
      claims = tokens.claims() as Record<string, unknown> | undefined;
    } catch (err) {
      console.warn('[auth] oidc callback failed:', err instanceof Error ? err.message : err);
      return c.text('Login failed.', 401);
    }

    const user = typeof claims?.[auth.userClaim] === 'string' ? (claims[auth.userClaim] as string).trim().toLowerCase() : '';
    if (!user || !auth.allowedUsers.has(user)) {
      console.warn(`[auth] oidc user not allowed: ${user ? JSON.stringify(user) : '(none)'}`);
      return c.text('This account is not allowed to use this app.', 403);
    }
    writeSession(c, user, auth.sessionSecret, auth.sessionDays);
    return c.redirect('/', 302);
  });

  return app;
}
