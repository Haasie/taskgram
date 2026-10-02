import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import webpush from 'web-push';

const vapidKeys = webpush.generateVAPIDKeys();
const dataDir = fs.mkdtempSync(os.tmpdir() + '/pt-e2e-');

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:4017',
    channel: process.env.PW_CHANNEL ?? 'chrome',
    locale: 'nl-NL',
    serviceWorkers: 'allow'
  },
  projects: [
    {
      name: 'desktop',
      use: {
        viewport: { width: 1280, height: 860 }
      }
    },
    {
      name: 'mobile',
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true
      },
      grep: /@mobile/
    }
  ],
  webServer: [
    {
      command: 'npx tsx tests/mock-postgram/server.ts',
      port: 4010,
      reuseExistingServer: false
    },
    {
      command: 'node dist-server/server/index.js',
      port: 4017,
      reuseExistingServer: false,
      env: {
        PORT: '4017',
        AUTH_MODE: 'dev',
        POSTGRAM_URL: 'http://localhost:4010',
        POSTGRAM_API_KEY: 'test',
        STATIC_DIR: 'dist',
        DATA_DIR: dataDir,
        VAPID_PUBLIC_KEY: vapidKeys.publicKey,
        VAPID_PRIVATE_KEY: vapidKeys.privateKey,
        VAPID_SUBJECT: 'mailto:test@example.com',
        NODE_ENV: 'test'
      }
    }
  ]
});
