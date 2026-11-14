# Modules

Taskgram's task lists are the core. Everything else is a **module**: an optional view with its own route and menu
item, optionally its own server API, that you switch on or off under **Settings → Modules**.

| Module | Route | Default | Docs |
| --- | --- | --- | --- |
| Dagplanning (day planning) | `#/dagplanning` | off | [dagplanning.md](dagplanning.md) |
| Leesdossier (reading file) | `#/lezen` | off | [leesdossier.md](leesdossier.md) |
| Werkradar / Privéradar | `#/radar/work`, `#/radar/personal` | on | [radar.md](radar.md) |
| Cockpit | `#/cockpit` | off | [cockpit.md](cockpit.md) |

## How a module behaves

- **Off means off.** A disabled module has no route, no menu item, and its API answers `404 MODULE_DISABLED`
  before anything reaches Postgram. Background jobs check the switch before every data call.
- **On/off and settings are stored on the server** in `DATA_DIR/modules.json`, so every device agrees.
- **Settings vs. secrets.** Non-secret settings (tags, categories, goals) are edited in the app. Secrets (tokens,
  passwords) only ever come from environment variables and never reach the browser.
- **Postgram stays the source of truth.** Modules read and write Postgram entities; they keep no data of their own
  besides the settings above.

## Building a module

A module is one folder under `modules/` — there is no central list to edit:

```
modules/<id>/
  module.ts    required   default export: the manifest (id = folder name)
  client.tsx   required   default export: the view, loaded lazily
  server.ts    optional   routes(ctx) → API under /api/modules/<id>/…, and optionally start(ctx)
```

**Manifest** (`modules/types.ts`):

```ts
const manifest: ModuleManifest = {
  id: 'example',                 // = folder name; used in storage and the API path
  route: 'example',              // #/example (may contain a slash)
  area: 'work',                  // optional: show under Work/Personal instead of the modules block
  order: 50,                     // menu order, low first
  title: { nl: 'Voorbeeld', en: 'Example' },
  description: { nl: '…', en: '…' },
  icon: ['M12 5v14', 'M5 12h14'], // 24×24 SVG paths (lucide style)
  defaultEnabled: false,          // new modules should default to off
  settings: [                     // optional, rendered automatically in Settings → Modules
    { key: 'goal', type: 'number', label: { nl: 'Doel', en: 'Goal' }, default: 4, min: 0, integer: true },
    { key: 'tag', type: 'string', label: { nl: 'Tag', en: 'Tag' }, default: 'example' },
    { key: 'kinds', type: 'options', label: { nl: 'Soorten', en: 'Kinds' }, default: [{ id: 'a', label: { nl: 'A', en: 'A' } }] }
  ],
  env: [{ name: 'EXAMPLE_TOKEN', secret: true, description: { nl: '…', en: '…' } }] // documentation only
};
export default manifest;
```

Setting types: `string`, `number`, `boolean`, `options` (an ordered list of `{ id, label }`; ids are `a-z0-9-`).

**View** — receives `{ today, settings }` with defaults already filled in:

```tsx
export default function ExampleView({ today, settings }: ModuleViewProps) { … }
```

Use `import '../_design'` and the `ld-*` classes for the shared *Dossier* (light) / *Terminal* (dark) look.

**Server** (`server/modules/routes.ts`, `ModuleContext`):

```ts
export function routes(ctx: ModuleContext) {        // ctx: pg, env, timeZone, isEnabled(), settings(), state
  const api = new Hono<AuthEnv>();
  api.get('/items', async (c) => c.json({ items: await ctx.pg.listEntities('document', [String(ctx.settings().tag)]) }));
  return api;
}
export function start(ctx: ModuleContext) { … }  // optional background job; check ctx.isEnabled() first
export async function digest(ctx, kind, message, lang) { … } // optional: adjust the core morning/evening push
```

- **`digest`** (optional) receives the core's morning or evening push (or `null` when the core had nothing to say) and
  returns it, possibly changed (text, link). Modules never send extra notifications. Only enabled modules are asked.
- **`startup: true`** in the manifest lets a module take over the screen on the first launch of the day (once per
  device, only from the start screen or Today). The app asks `GET /api/modules/<id>/startup` → `{ open, date }`.

Then add tests next to the module (`*.test.ts`, run by `npm test`) and, if it has UI, an e2e scenario.

## Private modules: an overlay build

Modules that only make sense for your own setup do not have to live in this public repository. Because modules are
discovered by folder, a private repository can add folders to `modules/` and build its own image:

```dockerfile
# In your private repo, next to your own modules/<id>/ folders
FROM node:22-alpine AS build
WORKDIR /app
ARG TASKGRAM_REF=main
RUN apk add --no-cache git && git clone --depth 1 --branch ${TASKGRAM_REF} https://github.com/Haasie/taskgram.git .
COPY modules/ ./modules/
RUN npm ci && npm run build && npm prune --omit=dev
# …then the same runtime stage as Taskgram's Dockerfile
```

Pin `TASKGRAM_REF` to a tag or commit so an upstream change cannot break your build unnoticed.

Server-side tests for a private module can live next to it as `modules/<id>/server.test.ts`; the client
typecheck skips that file, like `server.ts`. Run `npm run typecheck && npx vitest run` in the build stage, so an
image only exists when the core tests and your module tests pass together.
