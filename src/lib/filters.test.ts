import { describe, expect, it } from 'vitest';
import type { Task } from '../../shared/types';
import { boardColumn, EMPTY_FILTER, filterToQuery, matchesFilter, queryToFilter, sortTasks, type TaskFilter } from './filters';

const today = '2026-09-30';
let n = 0;
const task = (partial: Partial<Task> = {}): Task => ({
  id: `t${++n}`,
  version: 1,
  content: 'Taak',
  status: 'next',
  visibility: 'personal',
  tags: [],
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  ...partial,
  metadata: partial.metadata ?? {}
});
const f = (p: Partial<TaskFilter>): TaskFilter => ({ ...EMPTY_FILTER, ...p });

describe('filter query round-trip', () => {
  it('encodes only non-default values and decodes them back', () => {
    const filter = f({ tags: ['a', 'b c'], minPriority: 3, project: 'none', area: 'work', due: 'week', favorites: true, sort: 'priority', text: 'x/y' });
    const q = filterToQuery(filter);
    expect(queryToFilter(q)).toEqual(filter);
    expect(filterToQuery(EMPTY_FILTER)).toBe('');
  });

  it('ignores invalid values', () => {
    expect(queryToFilter('prio=9&due=bogus&area=mars&sort=?')).toEqual(EMPTY_FILTER);
  });
});

describe('matchesFilter', () => {
  it('excludes completed tasks', () => {
    expect(matchesFilter(task({ status: 'done' }), EMPTY_FILTER, today)).toBe(false);
  });

  it('requires all tags, minimum priority and favorites', () => {
    const t = task({ tags: ['a', 'b'], metadata: { priority: 3, favorite: true } });
    expect(matchesFilter(t, f({ tags: ['a', 'b'] }), today)).toBe(true);
    expect(matchesFilter(t, f({ tags: ['a', 'c'] }), today)).toBe(false);
    expect(matchesFilter(t, f({ minPriority: 4 }), today)).toBe(false);
    expect(matchesFilter(t, f({ favorites: true, minPriority: 3 }), today)).toBe(true);
    expect(matchesFilter(task(), f({ favorites: true }), today)).toBe(false);
  });

  it('filters on project and deadline windows', () => {
    const inP = task({ metadata: { project_id: 'p1', due_date: '2026-09-29' } });
    const loose = task({ metadata: { due_date: '2026-10-05' } });
    expect(matchesFilter(inP, f({ project: 'p1' }), today)).toBe(true);
    expect(matchesFilter(loose, f({ project: 'p1' }), today)).toBe(false);
    expect(matchesFilter(loose, f({ project: 'none' }), today)).toBe(true);
    expect(matchesFilter(inP, f({ due: 'overdue' }), today)).toBe(true);
    expect(matchesFilter(loose, f({ due: 'overdue' }), today)).toBe(false);
    expect(matchesFilter(loose, f({ due: 'week' }), today)).toBe(true);
    expect(matchesFilter(task(), f({ due: 'none' }), today)).toBe(true);
  });
});

describe('sortTasks', () => {
  it('sorts by priority and due date', () => {
    const a = task({ metadata: { priority: 1, due_date: '2026-10-03' } });
    const b = task({ metadata: { priority: 5 } });
    const c = task({ metadata: { priority: 3, due_date: '2026-10-01' } });
    expect(sortTasks([a, b, c], 'priority').map((t) => t.id)).toEqual([b.id, c.id, a.id]);
    expect(sortTasks([a, b, c], 'due').map((t) => t.id)).toEqual([c.id, a.id, b.id]);
  });
});

describe('boardColumn', () => {
  it('maps statuses to kanban columns', () => {
    expect(boardColumn(task({ status: 'inbox' }))).toBe('inbox');
    expect(boardColumn(task({ status: 'scheduled' }))).toBe('todo');
    expect(boardColumn(task({ status: 'active' }))).toBe('todo');
    expect(boardColumn(task({ status: 'waiting' }))).toBe('waiting');
    expect(boardColumn(task({ status: 'done' }))).toBe('done');
  });
});
