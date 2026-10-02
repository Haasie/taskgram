import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const subscriptionSchema = z.object({
  id: z.string(),
  endpoint: z.string(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string()
  }),
  label: z.string().nullable(),
  createdAt: z.string()
});

const settingsSchema = z.object({
  digestEnabled: z.boolean(),
  digestTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  language: z.enum(['nl', 'en']).default('nl')
});

const sentSchema = z.object({
  digest: z.string().nullable(),
  reminders: z.record(z.string(), z.string())
});

const pushStateSchema = z.object({
  subscriptions: z.array(subscriptionSchema),
  settings: settingsSchema,
  sent: sentSchema
});

export type PushSubscriptionRecord = z.infer<typeof subscriptionSchema>;
export type PushSettings = z.infer<typeof settingsSchema>;
export type PushSent = z.infer<typeof sentSchema>;
export type PushState = z.infer<typeof pushStateSchema>;

export type PushStore = ReturnType<typeof createPushStore>;

function defaultState(): PushState {
  return {
    subscriptions: [],
    settings: { digestEnabled: true, digestTime: '07:30', language: 'nl' },
    sent: { digest: null, reminders: {} }
  };
}

export function createPushStore(dir: string) {
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'push.json');

  let state: PushState;

  function load(): PushState {
    if (!existsSync(filePath)) {
      return defaultState();
    }
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const res = pushStateSchema.safeParse(parsed);
      if (res.success) {
        return res.data;
      }
      return defaultState();
    } catch {
      return defaultState();
    }
  }

  state = load();

  function save(): void {
    mkdirSync(dir, { recursive: true });
    const tmpPath = join(dir, `push.json.tmp.${randomUUID()}`);
    writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    renameSync(tmpPath, filePath);
  }

  return {
    getState(): PushState {
      return state;
    },

    addSubscription(sub: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
      label?: string | null;
    }): { id: string; isNew: boolean } {
      const existingIndex = state.subscriptions.findIndex((s) => s.endpoint === sub.endpoint);
      if (existingIndex >= 0) {
        const existing = state.subscriptions[existingIndex]!;
        state.subscriptions[existingIndex] = {
          ...existing,
          keys: sub.keys,
          label: sub.label !== undefined ? sub.label : existing.label
        };
        save();
        return { id: existing.id, isNew: false };
      }

      const id = randomUUID();
      const record: PushSubscriptionRecord = {
        id,
        endpoint: sub.endpoint,
        keys: sub.keys,
        label: sub.label ?? null,
        createdAt: new Date().toISOString()
      };
      state.subscriptions.push(record);
      save();
      return { id, isNew: true };
    },

    removeSubscription(endpoint: string): boolean {
      const initialLen = state.subscriptions.length;
      state.subscriptions = state.subscriptions.filter((s) => s.endpoint !== endpoint);
      if (state.subscriptions.length !== initialLen) {
        save();
        return true;
      }
      return false;
    },

    removeByEndpoints(endpoints: string[]): void {
      const set = new Set(endpoints);
      const initialLen = state.subscriptions.length;
      state.subscriptions = state.subscriptions.filter((s) => !set.has(s.endpoint));
      if (state.subscriptions.length !== initialLen) {
        save();
      }
    },

    updateSettings(settings: Partial<PushSettings>): PushSettings {
      state.settings = {
        ...state.settings,
        ...settings
      };
      save();
      return state.settings;
    },

    setDigestSent(today: string): void {
      state.sent.digest = today;
    },

    recordReminderSent(key: string, sentAtIso: string): void {
      state.sent.reminders[key] = sentAtIso;
    },

    pruneReminders(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000, nowMs: number = Date.now()): void {
      const threshold = nowMs - maxAgeMs;
      const pruned: Record<string, string> = {};
      for (const [key, sentAt] of Object.entries(state.sent.reminders)) {
        const time = Date.parse(sentAt);
        if (!Number.isNaN(time) && time >= threshold) {
          pruned[key] = sentAt;
        }
      }
      state.sent.reminders = pruned;
    },

    save
  };
}
