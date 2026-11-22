import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import { createApp } from '../app.js';
import type { Config } from '../config.js';
import type { PostgramClient } from '../postgram.js';
import { createFocusAlarms } from './focus.js';
import type { PushSender } from './sender.js';
import { createPushStore, type PushStore } from './store.js';

const PHONE = 'https://web.push.apple.com/phone';
const MAC = 'https://fcm.googleapis.com/fcm/send/mac';
const NOW = 1_700_000_000_000;

describe('focus alarms', () => {
  let dir: string;
  let store: PushStore;
  let sent: { endpoint: string; payload: unknown }[];
  let sender: PushSender;
  let pending: { fn: () => void; ms: number; cleared: boolean }[];

  const alarms = () =>
    createFocusAlarms({
      store,
      sender,
      now: () => NOW,
      setTimer: (fn, ms) => {
        const h = { fn, ms, cleared: false };
        pending.push(h);
        return h;
      },
      clearTimer: (h) => void ((h as { cleared: boolean }).cleared = true)
    });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pt-focus-'));
    store = createPushStore(dir);
    store.addSubscription({ endpoint: PHONE, keys: { p256dh: 'p', auth: 'a' } });
    store.addSubscription({ endpoint: MAC, keys: { p256dh: 'p', auth: 'a' } });
    sent = [];
    pending = [];
    sender = { send: vi.fn(async (sub, payload) => (sent.push({ endpoint: sub.endpoint, payload }), 'ok' as const)) };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('pushes only to the device that started the timer, at the end time', async () => {
    const a = alarms();
    expect(a.schedule({ endpoint: PHONE, endsAt: NOW + 25 * 60_000, title: 'Mail Piet', lang: 'nl' })).toBe(true);
    expect(pending[0]!.ms).toBe(25 * 60_000);
    pending[0]!.fn();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ endpoint: PHONE, payload: { title: 'Tijd is om', body: 'Mail Piet', url: '/#/today', tag: 'focus' } });
    expect(a.size()).toBe(0);
  });

  it('replaces the previous alarm of the same device and can be cancelled', () => {
    const a = alarms();
    a.schedule({ endpoint: PHONE, endsAt: NOW + 60_000, title: 'A', lang: 'en' });
    a.schedule({ endpoint: PHONE, endsAt: NOW + 120_000, title: 'B', lang: 'en' });
    expect(pending[0]!.cleared).toBe(true);
    expect(a.size()).toBe(1);
    a.cancel(PHONE);
    expect(pending[1]!.cleared).toBe(true);
    expect(a.size()).toBe(0);
  });

  it('refuses unknown devices, past times and timers longer than 4 hours', () => {
    const a = alarms();
    expect(a.schedule({ endpoint: 'https://evil.example/x', endsAt: NOW + 60_000, title: 'A', lang: 'nl' })).toBe(false);
    expect(a.schedule({ endpoint: PHONE, endsAt: NOW - 1, title: 'A', lang: 'nl' })).toBe(false);
    expect(a.schedule({ endpoint: PHONE, endsAt: NOW + 5 * 60 * 60_000, title: 'A', lang: 'nl' })).toBe(false);
    expect(pending).toHaveLength(0);
  });

  it('drops a subscription that the push service reports as gone', async () => {
    sender.send = vi.fn(async () => 'gone' as const);
    const a = alarms();
    a.schedule({ endpoint: PHONE, endsAt: NOW + 60_000, title: 'A', lang: 'nl' });
    pending[0]!.fn();
    await vi.waitFor(() => expect(store.getState().subscriptions.map((s) => s.endpoint)).toEqual([MAC]));
  });
});

describe('PUT/DELETE /api/push/focus', () => {
  it('validates input and reports whether an alarm was scheduled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pt-focus-app-'));
    try {
      const keys = webpush.generateVAPIDKeys();
      const store = createPushStore(dir);
      const config: Config = {
        pgmApiUrl: 'https://postgram.example',
        pgmApiKey: 'k',
        auth: { mode: 'dev' } as Config['auth'],
        port: 0,
        staticDir: './does-not-exist',
        appTimezone: 'Europe/Amsterdam',
        dataDir: dir,
        push: { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: 'mailto:test@example.com' }
      };
      const sender: PushSender = { send: vi.fn(async () => 'ok' as const) };
      const app = createApp(config, {} as PostgramClient, { pushStore: store, pushSender: sender });
      const h = { 'content-type': 'application/json', 'x-requested-with': 'taskgram' };
      const put = (body: unknown) => app.request('/api/push/focus', { method: 'PUT', headers: h, body: JSON.stringify(body) });

      store.addSubscription({ endpoint: PHONE, keys: { p256dh: 'p', auth: 'a' } });
      const ok = await put({ endpoint: PHONE, endsAt: Date.now() + 60_000, title: 'Mail' });
      expect(await ok.json()).toEqual({ scheduled: true });

      const unknown = await put({ endpoint: MAC, endsAt: Date.now() + 60_000, title: 'Mail' });
      expect(await unknown.json()).toEqual({ scheduled: false });

      expect((await put({ endpoint: PHONE, endsAt: 'soon', title: 'Mail' })).status).toBe(400);
      expect((await put({ endpoint: PHONE, endsAt: Date.now() + 60_000, title: 'x'.repeat(201) })).status).toBe(400);

      const del = await app.request('/api/push/focus', { method: 'DELETE', headers: h, body: JSON.stringify({ endpoint: PHONE }) });
      expect(del.status).toBe(200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
