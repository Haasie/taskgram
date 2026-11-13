import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostgramClient, RawEntity } from '../postgram.js';
import { createScheduler } from './scheduler.js';
import type { PushSender } from './sender.js';
import { createPushStore } from './store.js';

describe('server/push/scheduler', () => {
  let tempDir: string;
  let store: ReturnType<typeof createPushStore>;
  let sentCalls: Array<{ sub: any; payload: any }>;
  let goneEndpoints: Set<string>;
  let sender: PushSender;
  let rawTasks: RawEntity[];
  let shouldFailPg: boolean;
  let failDoneOnce = false;
  let pg: PostgramClient;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pt-sched-'));
    store = createPushStore(tempDir);
    store.addSubscription({
      endpoint: 'https://fcm.googleapis.com/fcm/send/sub1',
      keys: { p256dh: 'p256dh', auth: 'auth' }
    });

    sentCalls = [];
    goneEndpoints = new Set<string>();
    sender = {
      send: vi.fn(async (sub, payload) => {
        sentCalls.push({ sub, payload });
        if (goneEndpoints.has(sub.endpoint)) {
          return 'gone';
        }
        return 'ok';
      })
    };

    rawTasks = [];
    shouldFailPg = false;
    failDoneOnce = false;
    pg = {
      listTasks: vi.fn(async (status: string) => {
        if (shouldFailPg) throw new Error('Postgram down');
        if (status === 'done' && failDoneOnce) {
          failDoneOnce = false;
          throw new Error('done-lijst niet beschikbaar');
        }
        return rawTasks.filter((t) => t.status === status);
      }),
      getEntity: vi.fn(),
      deleteEntity: vi.fn()
    } as unknown as PostgramClient;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeTask(id: string, status: string, metadata: Record<string, unknown> = {}, content = 'Task ' + id): RawEntity {
    return {
      id,
      version: 1,
      type: 'task',
      content,
      status,
      visibility: 'personal',
      tags: [],
      metadata,
      created_at: '2026-09-01T10:00:00.000Z',
      updated_at: '2026-09-01T10:00:00.000Z'
    };
  }

  it('runs digest lifecycle (not at 07:29, sent at 07:30 with correct body, not at 08:00, sent next day)', async () => {
    // 2 tasks today (1 with start_date today, 1 with overdue deadline which also counts for today) -> today: 2, overdue: 1
    rawTasks = [
      makeTask('1', 'next', { start_date: '2026-09-30' }),
      makeTask('2', 'next', { due_date: '2026-09-28' }) // overdue, counts for isToday and overdue
    ];

    let current = new Date('2026-09-30T05:29:00Z'); // 07:29 in Amsterdam
    const scheduler = createScheduler({
      pg,
      store,
      sender,
      timeZone: 'Europe/Amsterdam',
      now: () => current
    });

    // 07:29 -> not sent
    await scheduler.tick();
    expect(sentCalls.filter((c) => c.payload.tag === 'digest')).toHaveLength(0);

    // 07:30 -> sent once with '2 taken vandaag · 1 te laat'
    current = new Date('2026-09-30T05:30:00Z'); // 07:30 in Amsterdam
    await scheduler.tick();
    const digestCalls = sentCalls.filter((c) => c.payload.tag === 'digest');
    expect(digestCalls).toHaveLength(1);
    expect(digestCalls[0]?.payload).toEqual({
      title: 'Vandaag',
      body: '2 taken vandaag · 1 te laat\n• Task 2\n• Task 1',
      url: '/#/today',
      tag: 'digest'
    });
    expect(store.getState().sent.digest).toBe('2026-09-30');

    // 08:00 -> not sent again the same day
    current = new Date('2026-09-30T06:00:00Z'); // 08:00 in Amsterdam
    await scheduler.tick();
    expect(sentCalls.filter((c) => c.payload.tag === 'digest')).toHaveLength(1);

    // Next day at 07:30 -> sent again
    current = new Date('2026-10-01T05:30:00Z'); // 07:30 next day
    // Adjust tasks for 2026-10-01
    rawTasks = [
      makeTask('1', 'next', { start_date: '2026-10-01' })
    ];
    await scheduler.tick();
    const digestCallsDay2 = sentCalls.filter((c) => c.payload.tag === 'digest');
    expect(digestCallsDay2).toHaveLength(2);
    expect(store.getState().sent.digest).toBe('2026-10-01');
  });

  it('zero counts -> not sent but sent.digest set', async () => {
    rawTasks = [
      makeTask('1', 'next', { start_date: '2026-10-15' }) // future task
    ];
    const current = new Date('2026-09-30T05:30:00Z');
    const scheduler = createScheduler({
      pg,
      store,
      sender,
      timeZone: 'Europe/Amsterdam',
      now: () => current
    });

    await scheduler.tick();
    expect(sentCalls.filter((c) => c.payload.tag === 'digest')).toHaveLength(0);
    expect(store.getState().sent.digest).toBe('2026-09-30');
  });

  it('reminder at 09:15 for task with start_date today sent once at 09:15 and not at 09:20 again; reminder for tomorrow not sent', async () => {
    rawTasks = [
      makeTask('task-today', 'next', { start_date: '2026-09-30', reminder_time: '09:15' }, 'Brood kopen'),
      makeTask('task-tomorrow', 'next', { start_date: '2026-10-01', reminder_time: '09:15' }, 'Morgen doen')
    ];

    let current = new Date('2026-09-30T07:15:00Z'); // 09:15 Amsterdam
    const scheduler = createScheduler({
      pg,
      store,
      sender,
      timeZone: 'Europe/Amsterdam',
      now: () => current
    });

    await scheduler.tick();
    const reminders = sentCalls.filter((c) => c.payload.tag?.startsWith('reminder-'));
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.payload).toEqual({
      title: 'Brood kopen',
      body: 'Herinnering',
      url: '/#/today',
      tag: 'reminder-task-today'
    });

    // 09:20 -> not sent again
    current = new Date('2026-09-30T07:20:00Z');
    await scheduler.tick();
    expect(sentCalls.filter((c) => c.payload.tag?.startsWith('reminder-'))).toHaveLength(1);
  });

  it("'gone' subscription removed", async () => {
    goneEndpoints.add('https://fcm.googleapis.com/fcm/send/sub1');
    rawTasks = [
      makeTask('1', 'next', { start_date: '2026-09-30' })
    ];
    const current = new Date('2026-09-30T05:30:00Z');
    const scheduler = createScheduler({
      pg,
      store,
      sender,
      timeZone: 'Europe/Amsterdam',
      now: () => current
    });

    await scheduler.tick();
    expect(store.getState().subscriptions).toHaveLength(0);
  });

  it('timezone boundary: now = 2026-09-30T22:30:00Z counts as 2026-10-01 local', async () => {
    // In Europe/Amsterdam (UTC+2 in Sept/Oct), 22:30:00Z is 00:30:00 on 2026-10-01
    rawTasks = [
      makeTask('task-oct', 'next', { start_date: '2026-10-01', reminder_time: '00:30' }, 'Nachtelijke taak')
    ];
    const current = new Date('2026-09-30T22:30:00Z');
    const scheduler = createScheduler({
      pg,
      store,
      sender,
      timeZone: 'Europe/Amsterdam',
      now: () => current
    });

    await scheduler.tick();
    const reminders = sentCalls.filter((c) => c.payload.tag === 'reminder-task-oct');
    expect(reminders).toHaveLength(1);
  });

  it('pg failure -> no throw, nothing sent', async () => {
    shouldFailPg = true;
    const current = new Date('2026-09-30T05:30:00Z');
    const scheduler = createScheduler({
      pg,
      store,
      sender,
      timeZone: 'Europe/Amsterdam',
      now: () => current
    });

    await expect(scheduler.tick()).resolves.not.toThrow();
    expect(sentCalls).toHaveLength(0);
  });

  it('formats digest and reminders in English when push language is en', async () => {
    store.updateSettings({ language: 'en' });
    rawTasks = [
      makeTask('1', 'next', { start_date: '2026-09-30' }),
      makeTask('2', 'next', { due_date: '2026-09-28' }),
      makeTask('task-en-rem', 'next', { start_date: '2026-09-30', reminder_time: '07:30' }, 'Buy milk')
    ];

    const current = new Date('2026-09-30T05:30:00Z'); // 07:30 Amsterdam
    const scheduler = createScheduler({
      pg,
      store,
      sender,
      timeZone: 'Europe/Amsterdam',
      now: () => current
    });

    await scheduler.tick();

    const digestCalls = sentCalls.filter((c) => c.payload.tag === 'digest');
    expect(digestCalls).toHaveLength(1);
    expect(digestCalls[0]?.payload).toEqual({
      title: 'Today',
      body: '3 tasks today · 1 overdue\n• Task 2\n• Task 1\n• Buy milk',
      url: '/#/today',
      tag: 'digest'
    });

    const reminderCalls = sentCalls.filter((c) => c.payload.tag === 'reminder-task-en-rem');
    expect(reminderCalls).toHaveLength(1);
    expect(reminderCalls[0]?.payload).toEqual({
      title: 'Buy milk',
      body: 'Reminder',
      url: '/#/today',
      tag: 'reminder-task-en-rem'
    });
  });

  describe('avondpush', () => {
    const at = (iso: string) => {
      let current = new Date(iso);
      const scheduler = createScheduler({ pg, store, sender, timeZone: 'Europe/Amsterdam', now: () => current });
      return { scheduler, set: (next: string) => { current = new Date(next); } };
    };
    const evening = () => sentCalls.filter((c) => c.payload.tag === 'evening');

    it('staat standaard uit', async () => {
      rawTasks = [makeTask('1', 'next', { start_date: '2026-10-01' })];
      const { scheduler } = at('2026-09-30T19:00:00Z'); // woensdag 21:00
      await scheduler.tick();
      expect(evening()).toHaveLength(0);
    });

    it('21:00: afgerond vandaag (tijdzone) + morgen met top 3, één keer per dag', async () => {
      store.updateSettings({ eveningEnabled: true, digestEnabled: false });
      rawTasks = [
        // Afgerond om 00:30 Amsterdam = 22:30Z de dag ervoor: telt voor vandaag.
        makeTask('d1', 'done', { completed_at: '2026-09-29T22:30:00Z' }),
        makeTask('d2', 'done', { completed_at: '2026-09-30T18:00:00Z' }),
        // 23:30Z = 01:30 de volgende dag in Amsterdam: telt niet voor 30-09.
        makeTask('d3', 'done', { completed_at: '2026-09-30T23:30:00Z' }),
        makeTask('d4', 'done', { completed_at: '2026-09-29T12:00:00Z' }),
        makeTask('m1', 'next', { start_date: '2026-10-01' }, 'Morgen A'),
        makeTask('m2', 'next', { start_date: '2026-10-01', priority: 5 }, 'Morgen B'),
        makeTask('m3', 'next', { due_date: '2026-09-29' }, 'Te laat'),
        makeTask('m4', 'next', { start_date: '2026-10-01' }, 'Morgen C'),
        makeTask('later', 'next', { start_date: '2026-10-09' }, 'Later')
      ];
      const { scheduler, set } = at('2026-09-30T18:59:00Z'); // 20:59
      await scheduler.tick();
      expect(evening()).toHaveLength(0);

      set('2026-09-30T19:00:00Z'); // 21:00
      await scheduler.tick();
      expect(evening()).toHaveLength(1);
      expect(evening()[0]?.payload).toEqual({
        title: 'Morgen',
        body: 'Vandaag 2 afgerond · morgen 4 taken\n• Te laat\n• Morgen B\n• Morgen A',
        url: '/#/upcoming',
        tag: 'evening'
      });
      expect(store.getState().sent.evening).toBe('2026-09-30');

      set('2026-09-30T20:00:00Z');
      await scheduler.tick();
      expect(evening()).toHaveLength(1);
    });

    it('zondag: komende week in plaats van morgen', async () => {
      store.updateSettings({ eveningEnabled: true, digestEnabled: false });
      rawTasks = [
        makeTask('w1', 'next', { start_date: '2026-10-07' }, 'Woensdag'),
        makeTask('w2', 'next', { start_date: '2026-10-20' }, 'Veel later')
      ];
      const { scheduler } = at('2026-10-04T19:00:00Z'); // zondag 21:00
      await scheduler.tick();
      expect(evening()[0]?.payload).toMatchObject({
        title: 'Komende week',
        body: 'Komende week 1 taak\n• Woensdag'
      });
    });

    it('niets afgerond en niets gepland: geen push, wel als verstuurd gemarkeerd', async () => {
      store.updateSettings({ eveningEnabled: true, digestEnabled: false });
      rawTasks = [makeTask('x', 'next', { start_date: '2026-10-20' })];
      const { scheduler } = at('2026-09-30T19:00:00Z');
      await scheduler.tick();
      expect(evening()).toHaveLength(0);
      expect(store.getState().sent.evening).toBe('2026-09-30');
    });

    it('tellen van afgeronde taken mislukt: niets sturen, volgende tick opnieuw', async () => {
      store.updateSettings({ eveningEnabled: true, digestEnabled: false });
      rawTasks = [makeTask('m1', 'next', { start_date: '2026-10-01' }, 'Morgen A')];
      failDoneOnce = true;
      const { scheduler } = at('2026-09-30T19:00:00Z');
      await scheduler.tick();
      expect(evening()).toHaveLength(0);
      expect(store.getState().sent.evening).toBeNull();
      await scheduler.tick();
      expect(evening()).toHaveLength(1);
    });
  });
});
