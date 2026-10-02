import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { serveStatic } from '@hono/node-server/serve-static';
import { ZodError } from 'zod';
import { authMiddleware, csrfMiddleware, type AuthEnv } from './auth.js';
import type { Config } from './config.js';
import { UpstreamError, type PostgramClient } from './postgram.js';
import { createApiRoutes } from './routes.js';
import { createAuthApiRoutes, createOidcRoutes } from './auth/routes.js';
import { createPushRoutes } from './push/routes.js';
import { createSender, type PushSender } from './push/sender.js';
import { createPushStore, type PushStore } from './push/store.js';

export function createApp(
  config: Config,
  pg: PostgramClient,
  opts?: { now?: () => Date; pushStore?: PushStore; pushSender?: PushSender | null }
) {
  const app = new Hono<AuthEnv>();

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"]
      },
      referrerPolicy: 'no-referrer',
      crossOriginEmbedderPolicy: false,
      permissionsPolicy: { camera: [], microphone: [], geolocation: [] }
    })
  );

  app.get('/healthz', (c) => c.text('ok'));

  app.use('/api/*', async (c, next) => {
    c.header('cache-control', 'no-store');
    await next();
  });
  const pushStore = opts?.pushStore ?? createPushStore(config.dataDir ?? './data');
  const pushSender = opts?.pushSender ?? (config.push ? createSender(config.push) : null);

  app.use('/api/*', csrfMiddleware, bodyLimit({ maxSize: 256 * 1024 }));
  app.route('/api/auth', createAuthApiRoutes(config));
  if (config.auth.mode === 'oidc') app.route('/auth/oidc', createOidcRoutes(config.auth));
  const requireAuth = authMiddleware(config);
  app.use('/api/*', (c, next) => (c.req.path.startsWith('/api/auth/') ? next() : requireAuth(c, next)));
  app.route('/api', createApiRoutes(pg, { timeZone: config.appTimezone, ...(opts?.now ? { now: opts.now } : {}) }));
  app.route('/api/push', createPushRoutes({ config, store: pushStore, sender: pushSender }));
  app.all('/api/*', (c) => c.json({ error: { code: 'NOT_FOUND', message: 'Unknown endpoint' } }, 404));

  app.onError((err, c) => {
    c.header('cache-control', 'no-store');
    if (err instanceof ZodError) {
      return c.json({ error: { code: 'VALIDATION', message: 'Invalid input', issues: err.issues.slice(0, 5) } }, 400);
    }
    if (err instanceof SyntaxError) {
      return c.json({ error: { code: 'VALIDATION', message: 'Invalid JSON' } }, 400);
    }
    if (err instanceof UpstreamError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
    }
    console.error('[error]', c.req.method, c.req.path, err);
    return c.json({ error: { code: 'INTERNAL', message: 'Something went wrong' } }, 500);
  });

  // Statische app; index.html en service worker nooit hard cachen.
  app.use(
    '*',
    serveStatic({
      root: config.staticDir,
      onFound: (path, c) => {
        c.header(
          'cache-control',
          path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
        );
        c.res;
      }
    })
  );
  app.get(
    '*',
    serveStatic({
      root: config.staticDir,
      path: 'index.html',
      onFound: (_p, c) => {
        c.header('cache-control', 'no-cache');
        c.res;
      }
    })
  );

  return app;
}
