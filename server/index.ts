import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPostgramClient } from './postgram.js';
import { createScheduler } from './push/scheduler.js';
import { createSender } from './push/sender.js';
import { createPushStore } from './push/store.js';

const config = loadConfig();
const pg = createPostgramClient(config);
const store = createPushStore(config.dataDir ?? './data');
const sender = config.push ? createSender(config.push) : null;
const app = createApp(config, pg, { pushStore: store, pushSender: sender });

if (config.push && sender) {
  const scheduler = createScheduler({
    pg,
    store,
    sender,
    timeZone: config.appTimezone
  });
  void scheduler.tick();
  setInterval(() => {
    void scheduler.tick();
  }, 60_000);
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`taskgram listening on :${info.port} (auth: ${config.auth.mode})`);
});
