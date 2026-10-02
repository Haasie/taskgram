import { loadAuthConfig } from './auth/config.js';
import type { AuthConfig } from './auth/types.js';

export type PushConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

export type Config = {
  pgmApiUrl: string;
  pgmApiKey: string;
  auth: AuthConfig;
  port: number;
  staticDir: string;
  appTimezone: string;
  push?: PushConfig | null;
  dataDir?: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing required env var ${name}`);
    return value;
  };

  const auth = loadAuthConfig(env);

  const pgmApiUrl = new URL(required('POSTGRAM_URL'));
  if (pgmApiUrl.protocol !== 'https:' && pgmApiUrl.hostname !== 'localhost') {
    throw new Error('POSTGRAM_URL must use https');
  }

  const appTimezone = env.APP_TIMEZONE?.trim() || 'Europe/Amsterdam';
  try {
    new Intl.DateTimeFormat('en', { timeZone: appTimezone });
  } catch {
    throw new Error(`Invalid APP_TIMEZONE: ${appTimezone}`);
  }

  const rawVapidPub = env.VAPID_PUBLIC_KEY?.trim() || null;
  const rawVapidPriv = env.VAPID_PRIVATE_KEY?.trim() || null;
  const rawVapidSub = env.VAPID_SUBJECT?.trim() || null;

  let push: PushConfig | null = null;
  if (rawVapidPub || rawVapidPriv || rawVapidSub) {
    if (!rawVapidPub || !rawVapidPriv || !rawVapidSub) {
      throw new Error('VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT must all be set together');
    }
    if (!rawVapidSub.startsWith('mailto:') && !rawVapidSub.startsWith('https://')) {
      throw new Error('VAPID_SUBJECT must start with "mailto:" or "https://"');
    }
    push = {
      publicKey: rawVapidPub,
      privateKey: rawVapidPriv,
      subject: rawVapidSub
    };
  }

  const dataDir = env.DATA_DIR?.trim() || './data';

  return {
    pgmApiUrl: pgmApiUrl.toString().replace(/\/$/, ''),
    pgmApiKey: required('POSTGRAM_API_KEY'),
    auth,
    port: Number(env.PORT ?? 3000),
    staticDir: env.STATIC_DIR ?? './dist',
    appTimezone,
    push,
    dataDir
  };
}
