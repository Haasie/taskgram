import type { Task } from './types.js';
import { normalizeDate, toISODate } from './dates.js';

export const startDate = (t: Task) => normalizeDate(t.metadata.start_date);
export const deadline = (t: Task) => normalizeDate(t.metadata.due_date);
export const projectId = (t: Task) => (typeof t.metadata.project_id === 'string' ? t.metadata.project_id : null);
export const isEvening = (t: Task) => t.metadata.evening === true;
export const checklist = (t: Task) => (Array.isArray(t.metadata.checklist) ? t.metadata.checklist : []);
export const sortOrder = (t: Task) =>
  typeof t.metadata.sort_order === 'number' ? t.metadata.sort_order : -Date.parse(t.createdAt) / 1000;
export const completedAt = (t: Task) =>
  typeof t.metadata.completed_at === 'string' ? t.metadata.completed_at : t.updatedAt;
export const isOpen = (t: Task) => t.status !== 'done' && t.status !== 'archived';

export function isToday(t: Task, today: string): boolean {
  if (!isOpen(t) || t.status === 'someday') return false;
  const start = startDate(t);
  const due = deadline(t);
  return (start !== null && start <= today) || (due !== null && due <= today);
}

/** Local calendar day of completion, or null when unknown/invalid (H7). */
export function completionDay(t: Task): string | null {
  const raw = completedAt(t);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : toISODate(new Date(ms));
}
