import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../auth.js';
import type { Config } from '../config.js';
import { isAllowedPushEndpoint } from './allowlist.js';
import type { PushSender } from './sender.js';
import type { PushStore } from './store.js';

const subscriptionBody = z
  .object({
    endpoint: z.string().url(),
    keys: z
      .object({
        p256dh: z.string().min(1),
        auth: z.string().min(1)
      })
      .strict(),
    label: z.string().nullable().optional()
  })
  .strict();

const unsubscribeBody = z
  .object({
    endpoint: z.string()
  })
  .strict();

const settingsBody = z
  .object({
    digestEnabled: z.boolean().optional(),
    digestTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    language: z.enum(['nl', 'en']).optional()
  })
  .strict();

const testBody = z
  .object({
    endpoint: z.string()
  })
  .strict();

export type PushRoutesOpts = {
  config: Config;
  store: PushStore;
  sender?: PushSender | null;
};

export function createPushRoutes(opts: PushRoutesOpts) {
  const routes = new Hono<AuthEnv>();

  routes.get('/config', (c) => {
    const isEnabled = Boolean(opts.config.push);
    return c.json({
      enabled: isEnabled,
      publicKey: opts.config.push?.publicKey ?? null,
      settings: opts.store.getState().settings
    });
  });

  // Guard for other push routes when push is disabled
  routes.use('*', async (c, next) => {
    if (!opts.config.push) {
      return c.json({ error: { code: 'PUSH_DISABLED', message: 'Push notifications are not configured' } }, 503);
    }
    await next();
  });

  routes.post('/subscriptions', async (c) => {
    const body = subscriptionBody.parse(await c.req.json());
    if (!isAllowedPushEndpoint(body.endpoint)) {
      return c.json({ error: { code: 'VALIDATION', message: 'Invalid endpoint' } }, 400);
    }

    const currentSubs = opts.store.getState().subscriptions;
    const exists = currentSubs.some((s) => s.endpoint === body.endpoint);
    if (!exists && currentSubs.length >= 20) {
      return c.json({ error: { code: 'LIMIT', message: 'Maximum number of subscriptions reached' } }, 409);
    }

    const { id } = opts.store.addSubscription(body);
    return c.json({ id }, 201);
  });

  routes.delete('/subscriptions', async (c) => {
    const body = unsubscribeBody.parse(await c.req.json());
    opts.store.removeSubscription(body.endpoint);
    return c.json({ ok: true });
  });

  routes.put('/settings', async (c) => {
    const body = settingsBody.parse(await c.req.json());
    const settings = opts.store.updateSettings(body);
    return c.json({ settings });
  });

  routes.post('/test', async (c) => {
    const body = testBody.parse(await c.req.json());
    const sub = opts.store.getState().subscriptions.find((s) => s.endpoint === body.endpoint);
    if (!sub) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Subscription not found' } }, 404);
    }

    if (opts.sender) {
      const res = await opts.sender.send(sub, {
        title: 'Taskgram',
        body: 'Test notification sent',
        url: '/#/',
        tag: 'test'
      });
      if (res === 'gone') {
        opts.store.removeSubscription(body.endpoint);
      }
    }

    return c.json({ ok: true });
  });

  return routes;
}
