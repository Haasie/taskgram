import type { Task } from '../../shared/types.js';
import type { TaskPatch } from './api';
import { todayISO } from '../../shared/dates.js';

export type WhenChoice =
  | { kind: 'today' }
  | { kind: 'evening' }
  | { kind: 'date'; date: string }
  | { kind: 'anytime' }
  | { kind: 'someday' }
  | { kind: 'waiting' }
  | { kind: 'inbox' };

/** Vertaalt een Things-achtige "Wanneer"-keuze naar Postgram-status en metadata. */
export function whenPatch(choice: WhenChoice, today = todayISO()): TaskPatch {
  switch (choice.kind) {
    case 'today':
      return { status: 'next', metadata: { start_date: today, evening: false } };
    case 'evening':
      return { status: 'next', metadata: { start_date: today, evening: true } };
    case 'date':
      return choice.date <= today
        ? { status: 'next', metadata: { start_date: choice.date, evening: false } }
        : { status: 'scheduled', metadata: { start_date: choice.date, evening: false } };
    case 'anytime':
      return { status: 'next', metadata: { start_date: null, evening: false } };
    case 'someday':
      return { status: 'someday', metadata: { start_date: null, evening: false } };
    case 'waiting':
      return { status: 'waiting' };
    case 'inbox':
      return { status: 'inbox', metadata: { start_date: null, evening: false } };
  }
}

export function whenLabel(task: Task, today = todayISO()): string | null {
  const start = typeof task.metadata.start_date === 'string' ? task.metadata.start_date.slice(0, 10) : null;
  if (task.status === 'someday') return 'Ooit';
  if (task.status === 'waiting') return 'Wachten';
  if (start && start <= today) return task.metadata.evening ? 'Vanavond' : 'Vandaag';
  if (start) return start;
  return null;
}
