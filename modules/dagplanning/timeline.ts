import type { Bucket, WorkMode } from './logic.js';

/**
 * Visuele dagtijdlijn: vaste afspraken op hun tijd, geplande taken in de gaten daartussen, vanaf nu.
 *
 * - Werktaken alleen binnen de werkdag (op een werkdag), privétaken erbuiten. Op een vrije dag mag alles overal.
 * - Volgorde = de volgorde van het plan; een taak wordt niet gesplitst.
 * - Wat niet meer past komt in `overflow`: geen schuld, wel eerlijk.
 * Alles in minuten sinds middernacht (lokale tijd).
 */
export const DAY_START = 7 * 60;
export const DAY_END = 23 * 60;
/** Kleinere gaten tonen we niet als "vrij": te kort om iets mee te doen. */
export const MIN_FREE = 15;

export type TimelineEvent = { title: string; calendar: string; start: number; end: number };
export type TimelineTask = { id: string; title: string; minutes: number; bucket: Bucket };

export type Block =
  | ({ kind: 'event' } & TimelineEvent)
  | ({ kind: 'task'; start: number; end: number } & TimelineTask)
  | { kind: 'free'; start: number; end: number };

export type Layout = { blocks: Block[]; overflow: TimelineTask[]; from: number; to: number };

type Range = [number, number];

export const toMin = (hhmm: string): number => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export const fmtTime = (min: number): string => {
  const m = Math.max(0, Math.round(min));
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Agenda-items met begin- en eindtijd ("HH:MM"); een eind van 00:00 of vóór het begin = tot middernacht. */
export function eventsFrom(items: { title: string; calendar: string; allDay: boolean; start: string | null; end: string | null }[]): TimelineEvent[] {
  return items
    .filter((e) => !e.allDay && e.start && e.end)
    .map((e) => {
      const start = toMin(e.start!);
      const endRaw = toMin(e.end!);
      return { title: e.title, calendar: e.calendar, start, end: endRaw <= start ? 24 * 60 : endRaw };
    })
    .sort((a, b) => a.start - b.start);
}

function windowsFor(bucket: Bucket, mode: WorkMode, workStart: number, workEnd: number): Range[] {
  if (mode === 'off') return [[DAY_START, DAY_END]];
  if (bucket === 'work') return [[Math.max(DAY_START, workStart), Math.min(DAY_END, workEnd)]];
  return [
    [DAY_START, Math.max(DAY_START, workStart)],
    [Math.min(DAY_END, workEnd), DAY_END]
  ];
}

/** Vroegste begin ≥ `from` waarop `len` minuten passen binnen een venster en niet over iets bezets heen. */
function earliestFit(len: number, from: number, windows: Range[], busy: Range[]): number | null {
  for (const [ws, we] of windows) {
    let t = Math.max(ws, from);
    for (;;) {
      if (t + len > we) break;
      const clash = busy.find(([bs, be]) => bs < t + len && be > t);
      if (!clash) return t;
      t = clash[1];
    }
  }
  return null;
}

export function layoutDay(input: {
  now: number;
  mode: WorkMode;
  workStart: number;
  workEnd: number;
  events: TimelineEvent[];
  tasks: TimelineTask[];
}): Layout {
  // Plannen vanaf nu, afgerond op hele vijf minuten.
  const cursor = Math.max(DAY_START, Math.ceil(input.now / 5) * 5);
  const busy: Range[] = input.events.map((e) => [e.start, e.end]);
  const placed: Block[] = [];
  const overflow: TimelineTask[] = [];

  for (const task of input.tasks) {
    const len = Math.max(5, Math.round(task.minutes));
    const at = earliestFit(len, cursor, windowsFor(task.bucket, input.mode, input.workStart, input.workEnd), busy);
    if (at === null) {
      overflow.push(task);
      continue;
    }
    busy.push([at, at + len]);
    placed.push({ kind: 'task', ...task, start: at, end: at + len });
  }

  const events: Block[] = input.events.map((e) => ({ kind: 'event', ...e }));
  const sorted = [...events, ...placed].sort((a, b) => a.start - b.start || (a.kind === 'event' ? -1 : 1));

  // Vrije gaten vanaf nu tonen, zodat zichtbaar is waar ruimte zit.
  const from = Math.min(DAY_START, ...sorted.map((b) => b.start));
  const to = Math.max(DAY_END, ...sorted.map((b) => b.end));
  const blocks: Block[] = [];
  let edge = cursor;
  for (const b of sorted) {
    if (b.start - edge >= MIN_FREE) blocks.push({ kind: 'free', start: edge, end: b.start });
    blocks.push(b);
    edge = Math.max(edge, b.end);
  }
  if (DAY_END - edge >= MIN_FREE) blocks.push({ kind: 'free', start: edge, end: DAY_END });
  return { blocks, overflow, from, to };
}
