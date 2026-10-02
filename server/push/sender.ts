import webpush from 'web-push';
import type { PushConfig } from '../config.js';

export type PushNotificationPayload = {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
};

export type PushSender = {
  send(
    sub: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: PushNotificationPayload
  ): Promise<'ok' | 'gone' | 'error'>;
};

export function createSender(vapid: PushConfig): PushSender {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

  return {
    async send(sub, payload) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys
          },
          JSON.stringify(payload),
          { TTL: 3600 }
        );
        return 'ok';
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          return 'gone';
        }
        console.error('[push] Failed to send push notification:', err?.message ?? err);
        return 'error';
      }
    }
  };
}
