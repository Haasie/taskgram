# Leesdossier (reading file)

A reading list on top of Postgram: what you are reading now, a numbered queue, a backlog per category, finished books
with ratings, stopped books, a quarterly goal, and a Markdown export for a notes vault. Optional one-way sync of
reading progress from a KOReader sync server.

- **Route:** `#/lezen` · **Default:** off · **Folder:** `modules/leesdossier/`
- **Languages:** Dutch and English (follows Taskgram's language setting)

## Data in Postgram

One `document` entity per book, tagged with the **book tag** (default `book`). Fields live in `metadata`:

| Field | Meaning |
| --- | --- |
| `title`, `author` | Book |
| `status` | `te-lezen` (to read), `lezend` (reading), `uit` (finished), `gestaakt` (stopped) |
| `cat` | Category id (see settings) |
| `rating` | 0 = none, 1–5 |
| `progress` | 0–100 |
| `order` | Queue position; `0` = not queued. Queue = to read with order > 0; backlog = to read with order 0 |
| `note`, `src`, `verify` | Note, recommended by, title/author still to check |
| `started`, `done_at`, `updated` | Dates (`YYYY-MM-DD`) |
| `vault_path` | Optional path of a matching note in your vault (used for wikilinks in the export) |
| `kosync_document`, `kosync_at` | Set by the KOReader sync: linked document hash and last processed sync |

`content` is `title — author` plus the note, so books are found by Postgram search.

## Settings (Settings → Modules → Leesdossier)

| Setting | Default | Notes |
| --- | --- | --- |
| Categories | 8 general categories (politics, philosophy, leadership, security, fiction, travel, cooking, other) | Ordered list of id + label. The order is the backlog order; books with an unknown category fall under the last one |
| Goal per quarter | 4 | Finished books counted by `done_at`; 0 hides the tile |
| Book tag | `book` | Changing it hides books with the old tag |
| Markdown export target | `Leeslijst.md` | Shown in the export panel (e.g. the path of your reading list in your vault) |
| Line above the title | `Dossier` | Small label in the header |

## KOReader sync (optional)

| Environment variable | |
| --- | --- |
| `KOSYNC_URL` | Sync server, e.g. `http://kosync:3000` (must offer `GET /syncs/documents`, as koreader-sync does) |
| `KOSYNC_USER` | User name |
| `KOSYNC_PASSWORD` | Password (secret; sent as an MD5 key like KOReader does) |
| `KOSYNC_SYNC_MINUTES` | Interval, default 15; `0` = only via the button |

Rules: one way (KOReader → Postgram). Books are matched on main title, then remembered by document hash. Progress
follows KOReader; a book to read becomes *reading* when progress appears and *finished* at 99%. Finished or stopped
books are never reset. Unknown documents are listed so you can add them with a category.

## API

`/api/modules/leesdossier/…`: `GET/POST books`, `PATCH/DELETE books/:id`, `GET kosync`, `POST kosync/sync`,
`POST kosync/adopt/:document`. Only entities that are documents with the book tag can be changed.

## Seeding

`scripts/seed-leesdossier.ts <file.json> [--dry-run]` imports books idempotently (never overwrites; recognises
existing books by seed id or title + author) and links them to mirrored vault notes with a `related_to` edge.
