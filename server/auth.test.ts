import * as client from 'openid-client';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadAuthConfig } from './auth/config.js';
import { hashPassword, verifyPassword } from './auth/password.js';
import { createOidcRoutes } from './auth/routes.js';
import type { OidcAuth } from './auth/types.js';
import type { Config } from './config.js';
import type { PostgramClient } from './postgram.js';
import { createPushStore } from './push/store.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SESSION_SECRET = 's'.repeat(40);
const pg = { listTasks: async () => [] } as unknown as PostgramClient;
const store = () => createPushStore(mkdtempSync(join(tmpdir(), 'auth-test-')));

const baseConfig = (auth: Config['auth']): Config => ({
  pgmApiUrl: 'https://postgram.example',
  pgmApiKey: 'k',
  auth,
  port: 0,
  staticDir: './does-not-exist',
  appTimezone: 'Europe/Amsterdam',
  push: null,
  dataDir: './does-not-exist'
});

const json = { 'content-type': 'application/json', 'x-requested-with': 'taskgram' };
const cookieFrom = (res: Response) => res.headers.get('set-cookie')?.split(';')[0] ?? '';

describe('password hashing', () => {
  it('verifies only the right password', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});

describe('password mode', async () => {
  const hash = await hashPassword('correct horse battery');
  const app = createApp(
    baseConfig({
      mode: 'password',
      username: 'alice',
      passwordHash: hash,
      passwordPlain: null,
      sessionSecret: SESSION_SECRET,
      sessionDays: 30,
      trustProxy: false
    }),
    pg,
    { pushStore: store(), pushSender: null }
  );

  const login = (username: string, password: string) =>
    app.request('/api/auth/login', { method: 'POST', headers: json, body: JSON.stringify({ username, password }) });

  it('rejects API calls without a session', async () => {
    expect((await app.request('/api/me')).status).toBe(401);
  });

  it('reports the mode and no user before login', async () => {
    const res = await app.request('/api/auth/config');
    expect(await res.json()).toEqual({ mode: 'password', user: null, loginUrl: null });
  });

  it('logs in with valid credentials and sets an HttpOnly session cookie', async () => {
    const res = await login('alice', 'correct horse battery');
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    const me = await app.request('/api/me', { headers: { cookie: cookieFrom(res) } });
    expect(await me.json()).toEqual({ user: 'alice' });
  });

  it('rejects a tampered session cookie', async () => {
    const res = await login('alice', 'correct horse battery');
    const cookie = cookieFrom(res).replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A'));
    expect((await app.request('/api/me', { headers: { cookie } })).status).toBe(401);
  });

  it('rejects wrong credentials and requires the CSRF header', async () => {
    expect((await login('alice', 'nope')).status).toBe(401);
    expect((await login('bob', 'correct horse battery')).status).toBe(401);
    const noCsrf = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'correct horse battery' })
    });
    expect(noCsrf.status).toBe(403);
  });

  it('logout clears the cookie', async () => {
    const res = await app.request('/api/auth/logout', { method: 'POST', headers: json });
    expect(res.headers.get('set-cookie')).toMatch(/taskgram_session=;.*Max-Age=0/);
  });
});

describe('password mode rate limiting', async () => {
  const app = createApp(
    baseConfig({
      mode: 'password',
      username: 'alice',
      passwordHash: null,
      passwordPlain: 'correct horse battery',
      sessionSecret: SESSION_SECRET,
      sessionDays: 30,
      trustProxy: false
    }),
    pg,
    { pushStore: store(), pushSender: null }
  );

  it('blocks after 10 failed attempts, even with the right password', async () => {
    const attempt = (password: string) =>
      app.request('/api/auth/login', { method: 'POST', headers: json, body: JSON.stringify({ username: 'alice', password }) });
    for (let i = 0; i < 10; i++) expect((await attempt('wrong')).status).toBe(401);
    const blocked = await attempt('correct horse battery');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('generic proxy mode', () => {
  const app = createApp(
    baseConfig({
      mode: 'proxy',
      userHeader: 'remote-user',
      secretHeader: 'x-proxy-secret',
      secret: 'p'.repeat(40),
      allowedUsers: new Set(['alice']),
      loginPath: '/api/login'
    }),
    pg,
    { pushStore: store(), pushSender: null }
  );

  it('accepts the configured user header with the secret', async () => {
    const res = await app.request('/api/me', { headers: { 'remote-user': 'alice', 'x-proxy-secret': 'p'.repeat(40) } });
    expect(await res.json()).toEqual({ user: 'alice' });
  });

  it('rejects requests without the secret and unknown users', async () => {
    expect((await app.request('/api/me', { headers: { 'remote-user': 'alice' } })).status).toBe(401);
    expect(
      (await app.request('/api/me', { headers: { 'remote-user': 'mallory', 'x-proxy-secret': 'p'.repeat(40) } })).status
    ).toBe(403);
  });

  it('tells the client where to log in', async () => {
    const res = await app.request('/api/auth/config');
    expect(await res.json()).toEqual({ mode: 'proxy', user: null, loginUrl: '/api/login' });
  });
});

describe('oidc login redirect', () => {
  const auth: OidcAuth = {
    mode: 'oidc',
    issuer: 'https://idp.example/',
    clientId: 'taken',
    clientSecret: null,
    redirectUrl: 'https://taken.example/auth/oidc/callback',
    scopes: 'openid email',
    userClaim: 'email',
    allowedUsers: new Set(['alice@example.com']),
    sessionSecret: SESSION_SECRET,
    sessionDays: 30
  };
  const configuration = new client.Configuration(
    {
      issuer: 'https://idp.example/',
      authorization_endpoint: 'https://idp.example/authorize',
      token_endpoint: 'https://idp.example/token'
    },
    'taken'
  );
  const routes = createOidcRoutes(auth, { discover: async () => configuration });

  it('redirects to the provider with PKCE, state and nonce', async () => {
    const res = await routes.request('/login');
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get('location')!);
    expect(url.origin + url.pathname).toBe('https://idp.example/authorize');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(auth.redirectUrl);
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('nonce')).toBeTruthy();
    expect(res.headers.get('set-cookie')).toContain('taskgram_oidc=');
  });

  it('rejects a callback without the state cookie', async () => {
    const res = await routes.request('/callback?code=x&state=y');
    expect(res.status).toBe(400);
  });
});

describe('auth config', () => {
  const env = { POSTGRAM_URL: 'https://x', POSTGRAM_API_KEY: 'k' };
  it('defaults to password mode and requires credentials and a session secret', () => {
    expect(() => loadAuthConfig({ ...env })).toThrow(/AUTH_USERNAME/);
    expect(() => loadAuthConfig({ ...env, AUTH_USERNAME: 'a', AUTH_PASSWORD: 'long enough pw' })).toThrow(/SESSION_SECRET/);
    expect(loadAuthConfig({ ...env, AUTH_USERNAME: 'a', AUTH_PASSWORD: 'long enough pw', SESSION_SECRET: SESSION_SECRET }).mode).toBe(
      'password'
    );
  });
  it('rejects short plain passwords and malformed hashes', () => {
    expect(() => loadAuthConfig({ AUTH_USERNAME: 'a', AUTH_PASSWORD: 'short', SESSION_SECRET })).toThrow(/12/);
    expect(() => loadAuthConfig({ AUTH_USERNAME: 'a', AUTH_PASSWORD_HASH: 'plain', SESSION_SECRET })).toThrow(/hash/);
  });
  it('maps cosmos to a proxy preset', () => {
    const auth = loadAuthConfig({ AUTH_MODE: 'cosmos', ALLOWED_USERS: 'alice', PROXY_SECRET: 'p'.repeat(40) });
    expect(auth).toMatchObject({ mode: 'proxy', userHeader: 'x-cosmos-user', secretHeader: 'x-proxy-secret' });
  });
  it('validates oidc settings', () => {
    const oidc = {
      AUTH_MODE: 'oidc',
      OIDC_ISSUER: 'https://idp.example',
      OIDC_CLIENT_ID: 'taken',
      OIDC_REDIRECT_URL: 'https://taken.example/auth/oidc/callback',
      ALLOWED_USERS: 'alice@example.com',
      SESSION_SECRET
    };
    expect(loadAuthConfig(oidc).mode).toBe('oidc');
    expect(() => loadAuthConfig({ ...oidc, OIDC_ISSUER: 'http://idp.example' })).toThrow(/https/);
    expect(() => loadAuthConfig({ ...oidc, OIDC_REDIRECT_URL: 'https://taken.example/cb' })).toThrow(/callback/);
  });
});
