import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPushStore } from './store.js';

describe('server/push/store', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pt-store-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('missing file -> default state', () => {
    const store = createPushStore(tempDir);
    expect(store.getState()).toEqual({
      subscriptions: [],
      settings: { digestEnabled: true, digestTime: '07:30', language: 'nl' },
      sent: { digest: null, reminders: {} }
    });
  });

  it('corrupt JSON -> default state', () => {
    writeFileSync(join(tempDir, 'push.json'), '{ broken: json', 'utf-8');
    const store = createPushStore(tempDir);
    expect(store.getState()).toEqual({
      subscriptions: [],
      settings: { digestEnabled: true, digestTime: '07:30', language: 'nl' },
      sent: { digest: null, reminders: {} }
    });
  });

  it('addSubscription upserts by endpoint', () => {
    const store = createPushStore(tempDir);
    const sub1 = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/sub1',
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
      label: 'Chrome Desktop'
    };

    const res1 = store.addSubscription(sub1);
    expect(res1.id).toBeDefined();
    expect(store.getState().subscriptions).toHaveLength(1);
    expect(store.getState().subscriptions[0]).toMatchObject({
      id: res1.id,
      endpoint: sub1.endpoint,
      keys: sub1.keys,
      label: 'Chrome Desktop'
    });

    // Upsert with updated label and keys
    const sub1Updated = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/sub1',
      keys: { p256dh: 'p256dh-new', auth: 'auth-new' },
      label: 'Updated Device'
    };
    const res2 = store.addSubscription(sub1Updated);
    expect(res2.id).toBe(res1.id);
    expect(store.getState().subscriptions).toHaveLength(1);
    expect(store.getState().subscriptions[0]?.keys.p256dh).toBe('p256dh-new');
    expect(store.getState().subscriptions[0]?.label).toBe('Updated Device');
  });

  it('write is atomic (no push.json.tmp* left, file parses)', () => {
    const store = createPushStore(tempDir);
    store.addSubscription({
      endpoint: 'https://fcm.googleapis.com/fcm/send/sub1',
      keys: { p256dh: 'p256dh', auth: 'auth' }
    });

    const files = readdirSync(tempDir);
    expect(files.some((f) => f.startsWith('push.json.tmp'))).toBe(false);
    expect(existsSync(join(tempDir, 'push.json'))).toBe(true);

    const raw = readFileSync(join(tempDir, 'push.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.subscriptions).toHaveLength(1);
    expect(parsed.subscriptions[0].endpoint).toBe('https://fcm.googleapis.com/fcm/send/sub1');
  });
});
