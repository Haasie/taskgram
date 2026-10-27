import { addDays } from '../../shared/dates.js';
import { completedAt, deadline, isFavorite, isOpen, priority, projectId, sortOrder } from '../../shared/taskFields.js';
import type { Task, Visibility } from '../../shared/types.js';
import { splitContent } from './task';

/** Vikunja-achtige filters: combineer labels, prioriteit, project, gebied en deadline. */
export type DueFilter = 'any' | 'overdue' | 'today' | 'week' | 'has' | 'none';
export type SortKey = 'manual' | 'due' | 'priority' | 'title' | 'created';

export type TaskFilter = {
  text: string;
  tags: string[];
  minPriority: number;
  project: string | null; // project-id, 'none' = zonder project, null = alle
  area: Visibility | null;
  due: DueFilter;
  favorites: boolean;
  sort: SortKey;
};

export const EMPTY_FILTER: TaskFilter = {
  text: '',
  tags: [],
  minPriority: 0,
  project: null,
  area: null,
  due: 'any',
  favorites: false,
  sort: 'manual'
};

const DUE: DueFilter[] = ['any', 'overdue', 'today', 'week', 'has', 'none'];
const SORTS: SortKey[] = ['manual', 'due', 'priority', 'title', 'created'];
const AREAS: Visibility[] = ['work', 'personal', 'shared'];

export function filterToQuery(f: TaskFilter): string {
  const q = new URLSearchParams();
  if (f.text.trim()) q.set('q', f.text);
  if (f.tags.length) q.set('tags', f.tags.join(','));
  if (f.minPriority) q.set('prio', String(f.minPriority));
  if (f.project) q.set('project', f.project);
  if (f.area) q.set('area', f.area);
  if (f.due !== 'any') q.set('due', f.due);
  if (f.favorites) q.set('fav', '1');
  if (f.sort !== 'manual') q.set('sort', f.sort);
  return q.toString();
}

export function queryToFilter(query: string): TaskFilter {
  const q = new URLSearchParams(query);
  const prio = Number(q.get('prio'));
  const due = q.get('due') as DueFilter | null;
  const sort = q.get('sort') as SortKey | null;
  const area = q.get('area') as Visibility | null;
  return {
    text: q.get('q') ?? '',
    tags: (q.get('tags') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    minPriority: Number.isInteger(prio) && prio >= 1 && prio <= 5 ? prio : 0,
    project: q.get('project') || null,
    area: area && AREAS.includes(area) ? area : null,
    due: due && DUE.includes(due) ? due : 'any',
    favorites: q.get('fav') === '1',
    sort: sort && SORTS.includes(sort) ? sort : 'manual'
  };
}

export function matchesFilter(t: Task, f: TaskFilter, today: string): boolean {
  if (!isOpen(t)) return false;
  if (f.favorites && !isFavorite(t)) return false;
  if (f.minPriority && priority(t) < f.minPriority) return false;
  if (f.tags.length && !f.tags.every((tag) => t.tags.includes(tag))) return false;
  if (f.area && t.visibility !== f.area) return false;
  if (f.project === 'none' ? projectId(t) !== null : f.project && projectId(t) !== f.project) return false;
  if (f.text.trim() && !t.content.toLowerCase().includes(f.text.trim().toLowerCase())) return false;
  const due = deadline(t);
  switch (f.due) {
    case 'overdue':
      return due !== null && due < today;
    case 'today':
      return due !== null && due <= today;
    case 'week':
      return due !== null && due <= addDays(today, 7);
    case 'has':
      return due !== null;
    case 'none':
      return due === null;
    default:
      return true;
  }
}

const bySortOrder = (a: Task, b: Task) => sortOrder(a) - sortOrder(b);

export function sortTasks(tasks: Task[], sort: SortKey): Task[] {
  const list = [...tasks];
  switch (sort) {
    case 'due':
      return list.sort((a, b) => (deadline(a) ?? '9999').localeCompare(deadline(b) ?? '9999') || bySortOrder(a, b));
    case 'priority':
      return list.sort((a, b) => priority(b) - priority(a) || bySortOrder(a, b));
    case 'title':
      return list.sort((a, b) => splitContent(a.content).title.localeCompare(splitContent(b.content).title));
    case 'created':
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    default:
      return list.sort(bySortOrder);
  }
}

// ---------- Opgeslagen filters (per apparaat) ----------

export type SavedFilter = { id: string; name: string; query: string };
const STORAGE_KEY = 'taskgram-saved-filters';
const listeners = new Set<() => void>();
let cache: SavedFilter[] | null = null;

export function loadSavedFilters(): SavedFilter[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    cache = Array.isArray(raw)
      ? raw.filter((f): f is SavedFilter => typeof f?.id === 'string' && typeof f?.name === 'string' && typeof f?.query === 'string')
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

function store(next: SavedFilter[]) {
  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  for (const fn of listeners) fn();
}

export const saveFilter = (name: string, query: string): SavedFilter => {
  const filter = { id: crypto.randomUUID().slice(0, 8), name, query };
  store([...loadSavedFilters(), filter]);
  return filter;
};
export const updateSavedFilter = (id: string, query: string) =>
  store(loadSavedFilters().map((f) => (f.id === id ? { ...f, query } : f)));
export const deleteSavedFilter = (id: string) => store(loadSavedFilters().filter((f) => f.id !== id));
export const subscribeSavedFilters = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));

// ---------- Kanban-bord ----------

export type BoardColumn = 'inbox' | 'todo' | 'waiting' | 'someday' | 'done';
export const BOARD_COLUMNS: BoardColumn[] = ['inbox', 'todo', 'waiting', 'someday', 'done'];

export function boardColumn(t: Task): BoardColumn {
  switch (t.status) {
    case 'inbox':
    case 'waiting':
    case 'someday':
      return t.status;
    case 'done':
    case 'archived':
      return 'done';
    default:
      return 'todo';
  }
}

/** Afgevinkte taken in de Klaar-kolom: nieuwste eerst. */
export const byCompletedDesc = (a: Task, b: Task) => completedAt(b).localeCompare(completedAt(a));

const LAYOUT_KEY = 'taskgram-project-layout';
export function projectLayout(id: string): 'list' | 'board' {
  try {
    return JSON.parse(window.localStorage.getItem(LAYOUT_KEY) ?? '{}')[id] === 'board' ? 'board' : 'list';
  } catch {
    return 'list';
  }
}
export function setProjectLayout(id: string, layout: 'list' | 'board') {
  try {
    const all = JSON.parse(window.localStorage.getItem(LAYOUT_KEY) ?? '{}');
    all[id] = layout;
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(all));
  } catch {}
}
