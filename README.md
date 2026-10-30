# Taskgram

A Things 3-style task app for [Postgram](https://github.com/ivo-toby/postgram) — fast, keyboard-friendly
on the desktop, installable on your phone, and usable offline. Postgram stays the source of truth:
Taskgram only reads and writes tasks through the Postgram API.

> Taskgram is an independent project. It works with Postgram but is not affiliated with or endorsed
> by the Postgram project.

## Features

- **Things-style lists** — Inbox, Today (with This Evening), Upcoming, Anytime, Someday, Waiting and
  Logbook; areas and projects; drag & drop; quick entry and quick find; keyboard shortcuts on desktop,
  swipe gestures on mobile.
- **Tasks with detail** — notes, checklists, tags, start date, deadline, reminders, and links to other
  Postgram knowledge (search and link memories, people, documents).
- **Vikunja-style power features** — priorities (low … do now), progress percentage, favorites, a kanban
  board per project, saved filters (labels, priority, project, area, deadline, sorting), task relations
  (blocked by, subtask of, depends on, duplicate of, related), duplicating tasks and Quick Add Magic:
  type `Call supplier +renovation *phone !4 tomorrow` to set project, label, priority and date at once
  (dates are only picked up at the end of the title, e.g. `… tomorrow` or `… due friday`).
- **Radar per area** (modules *Werkradar* and *Privéradar*, on by default) — a project board for Work and Personal: every Postgram project tagged `werkradar`
  or `priveradar` becomes a card with status (red/amber/green), phase, next step, external party,
  deadline and risk, plus a bar of its open tasks per status. Edit those fields inline; they are stored
  in the project's metadata, so other tools reading Postgram see the same picture.
- **Optional modules** — extra dashboards you switch on or off in Settings (stored on the server, so
  every device agrees). A disabled module has no route, no menu item and its API refuses requests.
  The first module is **Leesdossier** (`#/lezen`): a reading list with what you are reading now, a
  numbered queue, a backlog per category, finished books with ratings, a quarterly goal, and a Markdown
  export for an Obsidian reading list. It has its own "Dossier" (light) and "Terminal" (dark) styling.
- **Recurring tasks** — daily, weekly on chosen days, monthly, or N days/weeks after completion.
  Completing one creates exactly one next occurrence; undo removes it again.
- **Offline first** — the app and your tasks are cached on the device. Changes made offline are queued
  and synced automatically; real conflicts are shown instead of silently overwritten.
- **Push notifications** — a daily digest at a time you choose and per-task reminders (Web Push; on iOS
  after adding the app to the home screen).
- **Login your way** — built-in password login, a trusted reverse proxy (Authelia, Authentik,
  oauth2-proxy, Cosmos Cloud, …) or OpenID Connect.
- **Dutch and English** interface.

## How it works

```
browser (PWA) ──▶ Taskgram server (Node) ──▶ Postgram API
                  • holds the Postgram API key
                  • authentication, CSRF protection
                  • push notification scheduler
```

The browser never sees your Postgram API key. The server exposes a small, validated API that only
allows task operations (plus read-only knowledge search for linking).

### Mapping to Postgram

| In the app | In Postgram |
| --- | --- |
| Inbox | `status: inbox` |
| Today / This Evening | `metadata.start_date` ≤ today (`metadata.evening`), or deadline reached |
| Upcoming | `metadata.start_date` in the future (`status: scheduled`) |
| Anytime | `status: next` / `active` without a future start date |
| Someday | `status: someday` |
| Waiting | `status: waiting` |
| Logbook | `status: done` (`metadata.completed_at`) |
| Deadline | `metadata.due_date` |
| Checklist | `metadata.checklist` |
| Repeat | `metadata.recurrence`; chain via `recurrence_parent_id` / `recurrence_next_id` |
| Reminder | `metadata.reminder_time` (HH:MM, on the start date or deadline) |
| Project | a Postgram `project` entity; the task gets `metadata.project_id` and a `part_of` edge |
| Area | `visibility` (`work`, `personal`, `shared`) |
| Radar card | a `project` tagged `werkradar` / `priveradar`; fields in `metadata` (`code`, `naam`, `fase`, `rag`, `volgende_stap`, `extern`, `deadline`, `risico`, `sort`) |
| Notes | everything after the first line of `content` |
| Priority | `metadata.priority` (1 low … 5 do now) |
| Progress | `metadata.percent_done` (0–100) |
| Favorite | `metadata.favorite` |
| Task relations | Postgram edges between tasks (`blocked_by`, `part_of`, `depends_on`, `duplicates`, `related_to`) |
| Board column | derived from `status` (inbox, next/active/scheduled, waiting, someday, done) |
| Saved filters | stored per device in the browser (`localStorage`) |
| Module on/off | `modules.json` in `DATA_DIR` on the Taskgram server |
| Leesdossier book | a `document` tagged `book`; fields in `metadata` (`title`, `author`, `status` = `te-lezen`/`lezend`/`uit`/`gestaakt`, `cat`, `rating` 0–5, `progress` 0–100, `order` (0 = not queued), `note`, `src`, `verify`, `started`, `done_at`, `updated`, `vault_path`); `content` is "title — author" plus the note |
| Context | `metadata.context` plus linked Postgram entities (edges) |

## Getting started

You need a Postgram instance and an API key for it. Then:

```bash
cp .env.example .env      # fill in POSTGRAM_URL, POSTGRAM_API_KEY and a login method
docker compose up -d      # see docs/deployment.md
```

Put it behind HTTPS (offline mode, installation and push require a secure origin).
**[docs/deployment.md](docs/deployment.md)** covers every login mode, push notifications, reverse proxy
examples and updating.

## Development

Requires Node.js 22+.

```bash
npm install
cp .env.example .env      # set POSTGRAM_URL, POSTGRAM_API_KEY and AUTH_MODE=dev
npm run dev               # web app on http://localhost:5187, API on :3017
npm test                  # unit tests (Vitest)
npm run test:e2e          # end-to-end tests against a mock Postgram (needs Google Chrome)
npm run typecheck
npm run build
npm run hash-password     # create AUTH_PASSWORD_HASH for password mode
```

`AUTH_MODE=dev` disables authentication and refuses to start with `NODE_ENV=production`.

Project layout: `src/` React client (Vite, Tailwind, TanStack Query, service worker in `src/sw.ts`),
`server/` Hono server, `shared/` code used by both (dates, recurrence, list rules), `tests/` e2e suite
with a mock Postgram.

## Modules

A module is one entry in [`modules/registry.ts`](modules/registry.ts) plus one folder `modules/<id>/`:

- `client.tsx` — default export: the view (loaded lazily, only when the module is opened);
- `server.ts` — optional, exports `routes(pg)`: its API under `/api/modules/<id>/…`, only reachable while
  the module is enabled.

A module server receives a context (Postgram client, environment, time zone, `isEnabled()`) and may export
`start(ctx)` for background work, which must check `isEnabled()` before every data call.

**KOReader sync (Leesdossier).** Set `KOSYNC_URL`, `KOSYNC_USER` and `KOSYNC_PASSWORD` to a KOReader sync server
that offers `GET /syncs/documents` (e.g. koreader-sync). Every 15 minutes (`KOSYNC_SYNC_MINUTES`, 0 = only manual), and via “Sync KOReader”, reading progress
flows one way into the Leesdossier: books are matched on title (then remembered by document hash), progress is
updated, a queued book starts when progress appears, and at 99% it is marked finished. Finished or stopped books are
never reset. Unknown documents are listed so you can add them.

**Beheer.** Set `SUPERVISOR_URL` and `SUPERVISOR_TOKEN` to a Homelab Supervisor (haasiehomeops) and the module
shows its `/api/status`: containers, storage/ZFS/SMART, backup age, the last restore drill, what Claude did and the
audit log. Each state is shown with a word and a shape (● OK, ▲ LET OP, ■ ALARM), never colour alone; a supervisor
that has not polled for 15 minutes counts as an alarm. The token stays on the server.

Shared look for dashboard modules: `modules/_design` (Dossier light / Terminal dark), imported with `import '../_design'`.

New modules are off by default (`defaultEnabled`). `scripts/seed-leesdossier.ts <file.json>` is an idempotent
importer for Leesdossier books (it never overwrites existing books and links each book to a mirrored vault
note with a `related_to` edge).

## License

[MIT](LICENSE). Postgram is a separate project with its own license and trademark policy.
