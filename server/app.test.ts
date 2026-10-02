import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import { createApp } from './app.js';
import { loadConfig, type Config } from './config.js';
import type { PostgramClient } from './postgram.js';

const SECRET = 'x'.repeat(40);
const config: Config = {
  pgmApiUrl: 'https://postgram.example',
  pgmApiKey: 'k',
  auth: {
    mode: 'proxy',
    userHeader: 'x-cosmos-user',
    secretHeader: 'x-proxy-secret',
    secret: SECRET,
    allowedUsers: new Set(['alice']),
    loginPath: '/api/login'
  },
  port: 0,
  staticDir: './does-not-exist',
  appTimezone: 'Europe/Amsterdam'
};

const pg = {
  listTasks: vi.fn(async () => []),
  getEntity: vi.fn(async (id: string) => ({ id, type: 'project', content: '', visibility: 'personal', status: 'active', version: 1, tags: [], metadata: {}, created_at: '', updated_at: '' })),
  deleteEntity: vi.fn(async () => ({}))
} as unknown as PostgramClient;

const app = createApp(config, pg);
const authed = { 'x-proxy-secret': SECRET, 'x-cosmos-user': 'alice' };

describe('auth', () => {
  it('rejects requests without the proxy secret', async () => {
    const res = await app.request('/api/tasks', { headers: { 'x-cosmos-user': 'alice' } });
    expect(res.status).toBe(401);
  });

  it('rejects users not on the allowlist', async () => {
    const res = await app.request('/api/tasks', { headers: { ...authed, 'x-cosmos-user': 'mallory' } });
    expect(res.status).toBe(403);
  });

  it('rejects a 10-character wrong secret with 401', async () => {
    const res = await app.request('/api/tasks', { headers: { 'x-proxy-secret': 'shortsecre', 'x-cosmos-user': 'alice' } });
    expect(res.status).toBe(401);
  });

  it('accepts an allowed user via Cosmos', async () => {
    const res = await app.request('/api/me', { headers: authed });
    expect(await res.json()).toEqual({ user: 'alice' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('keeps the health check public', async () => {
    expect((await app.request('/healthz')).status).toBe(200);
  });
});

describe('cache-control (H9)', () => {
  it('sets no-store on 401 (missing secret)', async () => {
    const res = await app.request('/api/tasks', { headers: { 'x-cosmos-user': 'alice' } });
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('sets no-store on 403 (CSRF)', async () => {
    const res = await app.request('/api/tasks', { method: 'POST', headers: authed, body: '{}' });
    expect(res.status).toBe(403);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('sets no-store on 400 (bad body)', async () => {
    const res = await app.request('/api/tasks', {
      method: 'POST',
      headers: { ...authed, 'x-requested-with': 'taskgram', 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'x', metadata: { owner: 'x' } })
    });
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('sets no-store on 404 (/api/nope)', async () => {
    const res = await app.request('/api/nope', { headers: authed });
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('csrf', () => {
  it('requires the custom header on mutations', async () => {
    const res = await app.request('/api/tasks', { method: 'POST', headers: authed, body: '{}' });
    expect(res.status).toBe(403);
  });

  it('rejects cross-origin mutations', async () => {
    const res = await app.request('http://taken.local/api/tasks', {
      method: 'POST',
      headers: { ...authed, 'x-requested-with': 'taskgram', origin: 'https://evil.example', host: 'taken.local' },
      body: '{}'
    });
    expect(res.status).toBe(403);
  });

  it('passes CSRF with comma-separated x-forwarded-host and matching origin', async () => {
    const res = await app.request('/api/tasks', {
      method: 'POST',
      headers: {
        ...authed,
        'x-requested-with': 'taskgram',
        'content-type': 'application/json',
        'x-forwarded-host': 'taken.local, proxy.internal',
        origin: 'https://taken.local'
      },
      body: '{}'
    });
    expect(res.status).toBe(400);
  });

  it('passes CSRF with host containing port and matching origin', async () => {
    const res = await app.request('/api/tasks', {
      method: 'POST',
      headers: {
        ...authed,
        'x-requested-with': 'taskgram',
        'content-type': 'application/json',
        host: 'taken.local:443',
        origin: 'https://taken.local'
      },
      body: '{}'
    });
    expect(res.status).toBe(400);
  });

  it('rejects CSRF with evil origin', async () => {
    const res = await app.request('/api/tasks', {
      method: 'POST',
      headers: {
        ...authed,
        'x-requested-with': 'taskgram',
        'content-type': 'application/json',
        host: 'taken.local',
        origin: 'https://evil.example'
      },
      body: '{}'
    });
    expect(res.status).toBe(403);
  });
});

describe('validation', () => {
  const h = { ...authed, 'x-requested-with': 'taskgram', 'content-type': 'application/json' };

  it('rejects unknown metadata keys', async () => {
    const res = await app.request('/api/tasks', { method: 'POST', headers: h, body: JSON.stringify({ content: 'x', metadata: { owner: 'x' } }) });
    expect(res.status).toBe(400);
  });

  it('refuses to delete non-task entities via the task route', async () => {
    const res = await app.request('/api/tasks/5be51316-86c9-4b2e-9c7e-1a2b3c4d5e6f?version=1', { method: 'DELETE', headers: h });
    expect(res.status).toBe(404);
    expect(pg.deleteEntity).not.toHaveBeenCalled();
  });
});

describe('delete task (H8)', () => {
  it('checks version before deleting', async () => {
    const taskPg = {
      ...pg,
      getEntity: vi.fn(async (id: string) => ({
        id,
        type: 'task',
        content: 'T',
        visibility: 'personal',
        status: 'next',
        version: 3,
        tags: [],
        metadata: {},
        created_at: '',
        updated_at: ''
      })),
      deleteEntity: vi.fn(async () => ({}))
    } as unknown as PostgramClient;
    const taskApp = createApp(config, taskPg);
    const h = { ...authed, 'x-requested-with': 'taskgram' };

    const resFail = await taskApp.request('/api/tasks/5be51316-86c9-4b2e-9c7e-1a2b3c4d5e6f?version=2', {
      method: 'DELETE',
      headers: h
    });
    expect(resFail.status).toBe(409);
    expect(taskPg.deleteEntity).not.toHaveBeenCalled();

    const resOk = await taskApp.request('/api/tasks/5be51316-86c9-4b2e-9c7e-1a2b3c4d5e6f?version=3', {
      method: 'DELETE',
      headers: h
    });
    expect(resOk.status).toBe(200);
    expect(taskPg.deleteEntity).toHaveBeenCalledWith('5be51316-86c9-4b2e-9c7e-1a2b3c4d5e6f');
  });
});

describe('SPA fallback (H13)', () => {
  it('serves index.html with cache-control: no-cache on deep links', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'taken-static-'));
    try {
      writeFileSync(join(dir, 'index.html'), '<!doctype html><html></html>');
      const staticApp = createApp({ ...config, staticDir: dir }, pg);
      const res = await staticApp.request('/some/deep/link');
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-cache');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('config', () => {
  it('refuses cosmos mode without a strong proxy secret', () => {
    expect(() => loadConfig({ POSTGRAM_URL: 'https://x', POSTGRAM_API_KEY: 'k', AUTH_MODE: 'cosmos', ALLOWED_USERS: 'a', PROXY_SECRET: 'short' })).toThrow();
  });
  it('refuses dev mode in production', () => {
    expect(() => loadConfig({ POSTGRAM_URL: 'https://x', POSTGRAM_API_KEY: 'k', AUTH_MODE: 'dev', NODE_ENV: 'production' })).toThrow();
  });
  it('throws when only VAPID_PUBLIC_KEY is set', () => {
    expect(() =>
      loadConfig({
        POSTGRAM_URL: 'https://postgram.example',
        POSTGRAM_API_KEY: 'k',
        AUTH_MODE: 'dev',
        VAPID_PUBLIC_KEY: 'some-key'
      })
    ).toThrow();
  });
});

describe('push routes', () => {
  const h = { ...authed, 'x-requested-with': 'taskgram', 'content-type': 'application/json' };

  it('without VAPID -> GET /api/push/config enabled: false and POST /api/push/subscriptions -> 503 PUSH_DISABLED', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pt-app-disabled-'));
    try {
      const disabledApp = createApp({ ...config, push: null, dataDir: tempDir }, pg);
      const getRes = await disabledApp.request('/api/push/config', { headers: h });
      expect(getRes.status).toBe(200);
      const body = await getRes.json();
      expect(body).toEqual({
        enabled: false,
        publicKey: null,
        settings: { digestEnabled: true, digestTime: '07:30', language: 'nl' }
      });

      const postRes = await disabledApp.request('/api/push/subscriptions', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
          keys: { p256dh: 'p256', auth: 'auth' }
        })
      });
      expect(postRes.status).toBe(503);
      const postBody = await postRes.json();
      expect(postBody.error?.code).toBe('PUSH_DISABLED');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('with VAPID -> handles subscription allowlist, 20-subscription limit, and settings validation', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pt-app-push-'));
    try {
      const keys = webpush.generateVAPIDKeys();
      const pushApp = createApp(
        {
          ...config,
          push: { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: 'mailto:test@example.com' },
          dataDir: tempDir
        },
        pg
      );

      // Subscription with valid FCM endpoint -> 201
      const res1 = await pushApp.request('/api/push/subscriptions', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
          keys: { p256dh: 'p256', auth: 'auth' },
          label: 'My phone'
        })
      });
      expect(res1.status).toBe(201);
      const res1Body = await res1.json();
      expect(res1Body.id).toBeDefined();

      // https://evil.example/x -> 400
      const resEvil = await pushApp.request('/api/push/subscriptions', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          endpoint: 'https://evil.example/x',
          keys: { p256dh: 'p256', auth: 'auth' }
        })
      });
      expect(resEvil.status).toBe(400);

      // http://fcm.googleapis.com/… -> 400
      const resHttp = await pushApp.request('/api/push/subscriptions', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          endpoint: 'http://fcm.googleapis.com/fcm/send/abc',
          keys: { p256dh: 'p256', auth: 'auth' }
        })
      });
      expect(resHttp.status).toBe(400);

      // Add up to 20 subscriptions
      for (let i = 2; i <= 20; i++) {
        const resLoop = await pushApp.request('/api/push/subscriptions', {
          method: 'POST',
          headers: h,
          body: JSON.stringify({
            endpoint: `https://fcm.googleapis.com/fcm/send/sub${i}`,
            keys: { p256dh: 'p256', auth: 'auth' }
          })
        });
        expect(resLoop.status).toBe(201);
      }

      // 21st subscription -> 409 LIMIT
      const res21 = await pushApp.request('/api/push/subscriptions', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          endpoint: 'https://fcm.googleapis.com/fcm/send/sub21',
          keys: { p256dh: 'p256', auth: 'auth' }
        })
      });
      expect(res21.status).toBe(409);
      const res21Body = await res21.json();
      expect(res21Body.error?.code).toBe('LIMIT');

      // PUT /api/push/settings with digestTime: '25:00' -> 400
      const resBadSettings = await pushApp.request('/api/push/settings', {
        method: 'PUT',
        headers: h,
        body: JSON.stringify({
          digestEnabled: true,
          digestTime: '25:00'
        })
      });
      expect(resBadSettings.status).toBe(400);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
