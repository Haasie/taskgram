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
| Notes | everything after the first line of `content` |
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

## License

[MIT](LICENSE). Postgram is a separate project with its own license and trademark policy.
