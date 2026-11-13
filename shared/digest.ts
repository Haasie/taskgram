import type { Task } from './types.js';
import { addDays, parseISODate, todayInZone } from './dates.js';
import { completedAt, deadline, isOpen, isToday, priority, sortOrder } from './taskFields.js';

export type DigestLang = 'nl' | 'en';
export type DigestMessage = { title: string; body: string; url: string; tag: string };

const TOP = 3;
const TITLE_MAX = 60;

export function digestCounts(tasks: Task[], today: string) {
  const open = tasks.filter(isOpen);
  return {
    today: open.filter((t) => isToday(t, today)).length,
    overdue: open.filter((t) => (deadline(t) ?? '9999-12-31') < today).length
  };
}

/** Eerste regel van de taak, zonder markdown-kop, ingekort voor een pushregel. */
export function pushTitle(t: Task): string {
  const first = (t.content ?? '').replace(/\r\n/g, '\n').split('\n')[0]?.replace(/^#+\s*/, '').trim() ?? '';
  if (!first) return '…';
  return first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1).trimEnd()}…` : first;
}

/** Volgorde voor de top van een push: te laat eerst, dan prioriteit (hoog eerst), dan handmatige volgorde. */
export function topTasks(tasks: Task[], today: string, n = TOP): Task[] {
  const late = (t: Task) => ((deadline(t) ?? '9999-12-31') < today ? 0 : 1);
  return [...tasks]
    .sort((a, b) => late(a) - late(b) || priority(b) - priority(a) || sortOrder(a) - sortOrder(b))
    .slice(0, n);
}

const lines = (tasks: Task[]) => tasks.map((t) => `• ${pushTitle(t)}`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Ochtend: wat staat er vandaag, met de top 3 op titel. null = niets te melden. */
export function morningDigest(tasks: Task[], today: string, lang: DigestLang): DigestMessage | null {
  const counts = digestCounts(tasks, today);
  if (counts.today + counts.overdue === 0) return null;
  const isEn = lang === 'en';
  const head = isEn
    ? `${plural(counts.today, 'task', 'tasks')} today · ${counts.overdue} overdue`
    : `${plural(counts.today, 'taak', 'taken')} vandaag · ${counts.overdue} te laat`;
  const todays = tasks.filter((t) => isOpen(t) && isToday(t, today));
  return {
    title: isEn ? 'Today' : 'Vandaag',
    body: [head, ...lines(topTasks(todays, today))].join('\n'),
    url: '/#/today',
    tag: 'digest'
  };
}

/** Kalenderdag van afronden in de gegeven tijdzone (de server draait mogelijk in UTC). */
export function completionDayInZone(t: Task, timeZone: string): string | null {
  const raw = completedAt(t);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : todayInZone(new Date(ms), timeZone);
}

/** Zondag (lokale datum): de avondpush kijkt dan een week vooruit in plaats van alleen morgen. */
export const isSunday = (today: string) => parseISODate(today).getDay() === 0;

/**
 * Avond: hoeveel er vandaag af is, en wat er morgen (zondag: de komende week) op de lijst staat.
 * "Morgen" = wat de lijst Vandaag morgen toont, dus ook wat vandaag bleef liggen. null = niets te melden.
 */
export function eveningDigest(open: Task[], doneToday: number, today: string, lang: DigestLang): DigestMessage | null {
  const isEn = lang === 'en';
  const week = isSunday(today);
  const horizon = addDays(today, week ? 7 : 1);
  const ahead = open.filter((t) => isOpen(t) && isToday(t, horizon));
  if (doneToday === 0 && ahead.length === 0) return null;

  const done = isEn ? `${doneToday} done today` : `Vandaag ${doneToday} afgerond`;
  const next = week
    ? isEn ? `coming week: ${plural(ahead.length, 'task', 'tasks')}` : `komende week ${plural(ahead.length, 'taak', 'taken')}`
    : isEn ? `tomorrow: ${plural(ahead.length, 'task', 'tasks')}` : `morgen ${plural(ahead.length, 'taak', 'taken')}`;
  const head = doneToday > 0 ? `${done} · ${next}` : next.charAt(0).toUpperCase() + next.slice(1);
  return {
    title: week ? (isEn ? 'Coming week' : 'Komende week') : isEn ? 'Tomorrow' : 'Morgen',
    body: [head, ...lines(topTasks(ahead, addDays(today, 1)))].join('\n'),
    url: '/#/upcoming',
    tag: 'evening'
  };
}
