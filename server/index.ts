import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPostgramClient } from './postgram.js';
import { createScheduler } from './push/scheduler.js';
import { createSender } from './push/sender.js';
import { createPushStore } from './push/store.js';
import { createModuleRuntime } from './modules/routes.js';
import { createModuleStore } from './modules/store.js';

const config = loadConfig();
const pg = createPostgramClient(config);
const store = createPushStore(config.dataDir ?? './data');
const sender = config.push ? createSender(config.push) : null;
const moduleRuntime = createModuleRuntime({
  pg,
  store: createModuleStore(config.dataDir ?? './data'),
  env: process.env,
  timeZone: config.appTimezone
});
const app = createApp(config, pg, { pushStore: store, pushSender: sender, moduleRuntime });
moduleRuntime.start();

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
