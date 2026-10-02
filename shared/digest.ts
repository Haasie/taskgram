import type { Task } from './types.js';
import { deadline, isOpen, isToday } from './taskFields.js';

export function digestCounts(tasks: Task[], today: string) {
  const open = tasks.filter(isOpen);
  return {
    today: open.filter((t) => isToday(t, today)).length,
    overdue: open.filter((t) => (deadline(t) ?? '9999-12-31') < today).length
  };
}
