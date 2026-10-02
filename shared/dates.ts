import { dateWords } from './dateWords.js';

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(now = new Date()): string {
  return toISODate(now);
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Normaliseert willekeurige datumstrings uit Postgram naar YYYY-MM-DD, of null. */
export function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match?.[1] ?? null;
}

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((parseISODate(toISO).getTime() - parseISODate(fromISO).getTime()) / 86_400_000);
}

let currentLocale = 'nl-NL';
let currentWords = dateWords.nl;

let weekday = new Intl.DateTimeFormat(currentLocale, { weekday: 'long' });
let dayMonth = new Intl.DateTimeFormat(currentLocale, { day: 'numeric', month: 'short' });
let monthYear = new Intl.DateTimeFormat(currentLocale, { month: 'long', year: 'numeric' });
let month = new Intl.DateTimeFormat(currentLocale, { month: 'long' });

export function setDateLocale(locale: string): void {
  currentLocale = locale;
  currentWords = locale.toLowerCase().startsWith('nl') ? dateWords.nl : dateWords.en;
  weekday = new Intl.DateTimeFormat(currentLocale, { weekday: 'long' });
  dayMonth = new Intl.DateTimeFormat(currentLocale, { day: 'numeric', month: 'short' });
  monthYear = new Intl.DateTimeFormat(currentLocale, { month: 'long', year: 'numeric' });
  month = new Intl.DateTimeFormat(currentLocale, { month: 'long' });
}

export function getDateLocale(): string {
  return currentLocale;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Korte, relatieve weergave zoals Things: "Vandaag", "Morgen", "vr", "3 okt". */
export function formatShort(iso: string, today = todayISO()): string {
  const diff = daysBetween(today, iso);
  if (diff === 0) return currentWords.today;
  if (diff === 1) return currentWords.tomorrow;
  if (diff === -1) return currentWords.yesterday;
  if (diff > 1 && diff < 7) return capitalize(weekday.format(parseISODate(iso)));
  return dayMonth.format(parseISODate(iso));
}

export function formatDeadline(iso: string, today = todayISO()): string {
  const diff = daysBetween(today, iso);
  if (diff < 0) return currentWords.overdue(-diff);
  if (diff === 0) return currentWords.today;
  if (diff === 1) return currentWords.tomorrow;
  return currentWords.daysLeft(diff);
}

export function formatLong(iso: string): string {
  const d = parseISODate(iso);
  return `${capitalize(weekday.format(d))} ${dayMonth.format(d)}`;
}

export function formatMonth(iso: string, today = todayISO()): string {
  const d = parseISODate(iso);
  return capitalize(d.getFullYear() === parseISODate(today).getFullYear() ? month.format(d) : monthYear.format(d));
}

function partsInZone(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}
export const todayInZone = (now: Date, timeZone: string) => partsInZone(now, timeZone).date;
export const timeInZone = (now: Date, timeZone: string) => partsInZone(now, timeZone).time;
