import type { RecurrenceRule, Task } from './types.js';
import { addDays, daysBetween, parseISODate, toISODate } from './dates.js';
import { deadline, startDate } from './taskFields.js';

const NAMES = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const mondayIndex = (wd: number) => (wd + 6) % 7; // 0 = maandag

function ordinalEn(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0] || 'th');
}
const mondayOf = (iso: string) => addDays(iso, -mondayIndex(parseISODate(iso).getDay()));

export function nextOccurrence(rule: RecurrenceRule, anchor: string | null, completedOn: string): string {
  if (rule.type === 'after_completion') return addDays(completedOn, rule.every * (rule.unit === 'week' ? 7 : 1));
  const ref = anchor ?? completedOn;
  const base = ref > completedOn ? ref : completedOn;
  if (rule.type === 'daily') {
    const k = Math.floor(daysBetween(ref, base) / rule.interval) + 1;
    return addDays(ref, k * rule.interval);
  }
  if (rule.type === 'weekly') {
    const days = [...new Set(rule.weekdays)].sort((a, b) => mondayIndex(a) - mondayIndex(b));
    const refWeek = mondayOf(ref);
    let week = mondayOf(base);
    for (let i = 0; i <= rule.interval + 1; i++) {
      if (Math.round(daysBetween(refWeek, week) / 7) % rule.interval === 0) {
        for (const wd of days) {
          const d = addDays(week, mondayIndex(wd));
          if (d > base) return d;
        }
      }
      week = addDays(week, 7);
    }
    throw new Error('weekly rule without weekdays');
  }
  const r = parseISODate(ref);
  const b = parseISODate(base);
  let m = (b.getFullYear() - r.getFullYear()) * 12 + (b.getMonth() - r.getMonth());
  m -= m % rule.interval;
  for (;;) {
    const daysInMonth = new Date(r.getFullYear(), r.getMonth() + m + 1, 0).getDate();
    const d = toISODate(new Date(r.getFullYear(), r.getMonth() + m, Math.min(rule.day, daysInMonth)));
    if (d > base) return d;
    m += rule.interval;
  }
}

export function describeRule(rule: RecurrenceRule, lang: 'nl' | 'en' = 'nl'): string {
  const n = (count: number, one: string, many: string) => (count === 1 ? one : `${count} ${many}`);
  if (lang === 'en') {
    switch (rule.type) {
      case 'daily':
        return rule.interval === 1 ? 'Every day' : `Every ${rule.interval} days`;
      case 'weekly': {
        const days = [...new Set(rule.weekdays)]
          .sort((a, b) => mondayIndex(a) - mondayIndex(b))
          .map((d) => NAMES_EN[d])
          .join(', ');
        return `${rule.interval === 1 ? 'Every week' : `Every ${rule.interval} weeks`} on ${days}`;
      }
      case 'monthly':
        return `${rule.interval === 1 ? 'Every month' : `Every ${rule.interval} months`} on the ${ordinalEn(rule.day)}`;
      case 'after_completion':
        return `${rule.unit === 'week' ? (rule.every === 1 ? '1 week' : `${rule.every} weeks`) : (rule.every === 1 ? '1 day' : `${rule.every} days`)} after completion`;
    }
  }
  switch (rule.type) {
    case 'daily': return rule.interval === 1 ? 'Elke dag' : `Elke ${rule.interval} dagen`;
    case 'weekly': {
      const days = [...new Set(rule.weekdays)].sort((a, b) => mondayIndex(a) - mondayIndex(b)).map((d) => NAMES[d]).join(', ');
      return `${rule.interval === 1 ? 'Elke week' : `Elke ${rule.interval} weken`} op ${days}`;
    }
    case 'monthly': return `${rule.interval === 1 ? 'Elke maand' : `Elke ${rule.interval} maanden`} op de ${rule.day}e`;
    case 'after_completion': return `${rule.unit === 'week' ? n(rule.every, '1 week', 'weken') : n(rule.every, '1 dag', 'dagen')} na afronden`;
  }
}

export function nextTaskDates(task: Task, completedOn: string): { start_date: string | null; due_date: string | null } {
  const rule = task.metadata.recurrence;
  if (!rule) throw new Error('task has no recurrence');
  const start = startDate(task);
  const due = deadline(task);
  const next = nextOccurrence(rule, start ?? due, completedOn);
  if (start && due) return { start_date: next, due_date: addDays(next, daysBetween(start, due)) };
  if (due) return { start_date: null, due_date: next };
  return { start_date: next, due_date: null };
}
