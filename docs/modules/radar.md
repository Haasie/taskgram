# Werkradar and Privéradar (project radar)

A project board per area: every Postgram project with the radar tag becomes a card with status (red / amber /
green), phase, next step, external party, deadline and risk, plus a bar of its open tasks per status. The fields are
edited inline and stored in the project's metadata, so other tools reading Postgram see the same picture.

- **Routes:** `#/radar/work` (Werkradar), `#/radar/personal` (Privéradar)
- **Default:** on (both) · **Folders:** `modules/werkradar/`, `modules/priveradar/` (shared code in `src/components/RadarView.tsx`)
- **Menu:** shown under the Work / Personal area instead of the modules block

## Data in Postgram

| | |
| --- | --- |
| Card | a `project` in the area (`visibility` work / personal) with the radar tag |
| Fields | `metadata.code`, `naam`, `fase`, `rag` (`rood` / `oranje` / `groen`), `volgende_stap`, `extern`, `deadline`, `risico`, `sort` |
| Counts | open tasks linked to the project (`metadata.project_id`) per status |

Order: deadline first (earliest on top), then red · amber · green, then `sort`.

## Settings (Settings → Modules → Werkradar / Privéradar)

| Setting | Default | Notes |
| --- | --- | --- |
| Postgram tag for project cards | `werkradar` / `priveradar` | Projects in the area with this tag become cards |
| Inbox task counts as stale after (days) | 28 | Feeds the "inbox > N weeks" counter |

The radar uses Taskgram's own project API; it has no module API of its own.
