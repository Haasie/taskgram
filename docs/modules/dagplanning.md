# Dagplanning (day planning)

A morning ritual to plan your day and an evening ritual to close it, with a capacity check that tells you *before*
you overplan. You never estimate durations yourself: a first estimate comes from AI or a fixed rule, and your own
closed day plans correct it.

- **Route:** `#/dagplanning` · **Default:** off · **Folder:** `modules/dagplanning/`
- **Languages:** Dutch and English (follows Taskgram's language setting)

## Why it works this way

- **No self-estimation.** Many people (ADHD or not) are poor at guessing how long things take. The module does not ask.
- **A correction that learns.** After every closed day the module knows what you planned and what you finished. The
  correction factor is *planned ÷ finished* (raw estimates, last 20 closed days, bounded 1–3). Until there are 5 closed
  days it uses the *starting correction* from the settings (default ×1.5).
- **A pre-filled plan, not a blank page.** The morning screen preselects what is already on Today, by urgency, as far as
  it fits. Overdue tasks always come along. You remove or add.
- **No guilt mechanics.** No streaks, no red-for-shame, no catch-up nagging. Skip the evening ritual and the next
  morning closes yesterday's plan automatically from what was actually completed.
- **The inbox stays out.** The morning screen shows only the inbox count and a link; triage is a separate job.
- **Agents run in parallel, your attention does not.** Tasks with the agent tag (default `agent`) do not count their
  run time, only your attention for kicking off and reviewing (default 20 minutes). Above *maximum agents at once*
  (default 3) the plan asks for confirmation, because more agents means more switching.

## Personal calendar

If Taskgram has calendar feeds (`CALENDAR_FEEDS`, or `BRIEFING_CALENDAR_FEEDS` for existing installs — see
[Shared calendar](README.md#shared-calendar)), the morning screen lists today's events and takes their time off the
available time:

- Timed events inside the workday window (*Workday starts/ends*, default 08:30–17:00, weekdays only) count against
  **Work**; the rest of the waking hours (07:00–23:00) count against **Personal**. On a day set to *off*, everything counts
  against Personal.
- Overlapping events count once. All-day events (birthdays, holidays) are shown but do not take time.
- If a feed is unreachable the plan counts without it and says so.

Only personal feeds belong here. Your work calendar is never read.

## The rituals

**Morning** (opened by the morning push, or automatically on the first launch of the day)

1. Pick the kind of workday: *normal*, *lots of meetings* or *off* (weekends default to off). This replaces a calendar
   connection: your work calendar never has to be read.
2. Two meters, *Work* and *Personal*: planned load against available time, with a shape and a word —
   ● Room, ▲ Tight, ■ Overfull.
3. *Left over from yesterday*: one button sends all of it to later, or choose per task. Choosing nothing leaves it where it is.
4. *Today*: preselected; tick to plan. *Add?*: important or favourite tasks not on Today yet.
5. *Lock in plan*. If a meter is overfull (or there are too many agents), the plan asks once: *on purpose?* After that it stays quiet.

Planned tasks that were not on Today yet are moved there.

**Evening** (opened by the evening push)

- What got done, with an optional *took longer* / *was quicker* per task (shifts that task's estimate one step and marks it as yours).
- What was left over: *tomorrow*, *later* or *someday* per task, or leave it.
- *Close the day*.

## Estimates

Each task gets `metadata.estimate_min` and `metadata.estimate_source` (`ai`, `rule` or `user`) the first time it shows
up in the morning ritual without one. Values are snapped to 5, 10, 15, 30, 45, 60, 90, 120, 180 or 240 minutes.

- **AI** (setting *AI estimates* on and `MISTRAL_API_KEY` set): only the **title (first line)** of each task is sent
  to Mistral (chat completions, JSON mode), never notes or checklists, in batches of up to 25. Model:
  `DAGPLANNING_MODEL`, default `mistral-small-latest`. If the call fails or returns something unusable, the rule takes over.
- **Rule** (always available, nothing leaves the server): the kind of verb in the title (*call*, *mail* → 15 min;
  *review*, *check* → 30; *prepare*, *write*, meetings → 60; *build*, *deliver*, *migrate* → 120), plus 10 minutes per
  open checklist item.
- **You**: one tap in the evening ritual.

> Work task titles go to the AI too when AI estimates are on. If titles may contain names you do not want in a prompt,
> switch *AI estimates* off: the rule and the learned correction still work.

## Data in Postgram

One `document` per day, tagged `dagplan`, visibility `personal`. The content is only the date and counts — no task
titles — so titles are not copied into a second entity. Fields in `metadata`:

| Field | Meaning |
| --- | --- |
| `date` | `YYYY-MM-DD` |
| `planned` | Task ids planned for that day |
| `est` | Raw estimate (minutes, before correction) per planned task at planning time |
| `agents` | Planned task ids that are agent tasks |
| `work_mode` | `normal`, `busy` or `off` |
| `ack_over` | The plan was knowingly overfull |
| `closed`, `done` | Closed (evening, or automatically the next morning) and the planned ids completed that day |

## Push notifications

The module does not send extra notifications. It hooks into the existing morning and evening digests
(`ModuleServer.digest`): in the morning without a plan the digest starts with *Plan your day* and opens the ritual; in
the evening with a plan it starts with *n of m planned done · close your day*.

## Settings (Settings → Modules → Dagplanning)

| Setting | Default | Notes |
| --- | --- | --- |
| Work time on a normal workday | 300 min | Time for tasks next to meetings; start low |
| Work time on a busy day | 120 min | |
| Personal time on a weekday / weekend day | 90 / 240 min | |
| Attention per agent task | 20 min | Kick-off plus review |
| Maximum agents at once | 3 | Above this the plan asks for confirmation |
| Tag for agent tasks | `agent` | |
| Count the personal calendar | on | Uses the shared calendar feeds |
| Workday starts / ends | 08:30 / 17:00 | Events in this window count against Work |
| Starting correction | 1.5 | Until 5 closed days |
| AI estimates | on | Needs `MISTRAL_API_KEY` |
| Open the ritual on first launch each day | on | Once per day per device, only from the start screen or Today |

## Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `MISTRAL_API_KEY` | no | Enables AI estimates. Without it the module uses the rule only. |
| `DAGPLANNING_MODEL` | no | Mistral model for estimates, default `mistral-small-latest` |
| `MISTRAL_BASE_URL` | no | Default `https://api.mistral.ai/v1` |
| `CALENDAR_FEEDS` | no | Personal calendar feeds, shared by all modules (falls back to `BRIEFING_CALENDAR_FEEDS`) |
