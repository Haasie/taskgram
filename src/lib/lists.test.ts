import { describe, expect, it } from 'vitest';
import type { Task } from '../../shared/types';
import { buildSections, inList, orderBetween } from './lists';
import { whenPatch } from './when';

const today = '2026-09-30';
let n = 0;
const task = (partial: Partial<Task> & { metadata?: Task['metadata'] } = {}): Task => ({
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

describe('inList', () => {
  it('puts plain inbox tasks only in Inbox', () => {
    const t = task({ status: 'inbox' });
    expect(inList(t, 'inbox', today)).toBe(true);
    expect(inList(t, 'today', today)).toBe(false);
    expect(inList(t, 'anytime', today)).toBe(false);
  });

  it('moves inbox tasks with an overdue deadline to Today', () => {
    const t = task({ status: 'inbox', metadata: { due_date: '2026-09-20' } });
    expect(inList(t, 'today', today)).toBe(true);
    expect(inList(t, 'inbox', today)).toBe(false);
  });

  it('shows tasks with a past or current start date in Today and Anytime', () => {
    const t = task({ metadata: { start_date: '2026-09-29' } });
    expect(inList(t, 'today', today)).toBe(true);
    expect(inList(t, 'anytime', today)).toBe(true);
    expect(inList(t, 'upcoming', today)).toBe(false);
  });

  it('shows future tasks only in Upcoming', () => {
    const t = task({ status: 'scheduled', metadata: { start_date: '2026-10-05' } });
    expect(inList(t, 'upcoming', today)).toBe(true);
    expect(inList(t, 'today', today)).toBe(false);
    expect(inList(t, 'anytime', today)).toBe(false);
  });

  it('keeps someday tasks out of Today even with a deadline', () => {
    const t = task({ status: 'someday', metadata: { due_date: '2026-09-01' } });
    expect(inList(t, 'someday', today)).toBe(true);
    expect(inList(t, 'today', today)).toBe(false);
  });

  it('accepts ISO datetimes in metadata', () => {
    expect(inList(task({ metadata: { due_date: '2026-09-30T10:00:00Z' } }), 'today', today)).toBe(true);
  });

  it('excludes done tasks from every open list', () => {
    const t = task({ status: 'done', metadata: { start_date: today } });
    for (const kind of ['inbox', 'today', 'upcoming', 'anytime', 'someday', 'waiting'] as const) {
      expect(inList(t, kind, today)).toBe(false);
    }
  });

  it('H5: keeps waiting tasks out of Altijd', () => {
    expect(inList(task({ status: 'waiting' }), 'anytime', today)).toBe(false);
    expect(inList(task({ status: 'waiting', metadata: { due_date: today } }), 'today', today)).toBe(true);
  });
});

describe('buildSections', () => {
  const fmt = (d: string) => d;
  it('splits Today into day and evening', () => {
    const tasks = [task({ metadata: { start_date: today } }), task({ metadata: { start_date: today, evening: true } })];
    const sections = buildSections({ kind: 'today' }, tasks, [], today, () => '', fmt, fmt);
    expect(sections.map((s) => [s.key, s.tasks.length])).toEqual([
      ['today', 1],
      ['evening', 1]
    ]);
  });

  it('groups Upcoming by the next 7 days, then by month', () => {
    const tasks = [task({ status: 'scheduled', metadata: { start_date: '2026-10-02' } }), task({ status: 'scheduled', metadata: { start_date: '2026-11-15' } })];
    const sections = buildSections({ kind: 'upcoming' }, tasks, [], today, () => '', fmt, fmt);
    expect(sections).toHaveLength(8);
    expect(sections.find((s) => s.key === '2026-10-02')?.tasks).toHaveLength(1);
    expect(sections.find((s) => s.key === '2026-11')?.tasks).toHaveLength(1);
  });

  it('H10: area view hides future scheduled tasks', () => {
    const future = task({ status: 'scheduled', metadata: { start_date: '2026-12-01' } });
    const now = task({ status: 'next' });
    const sections = buildSections({ kind: 'area', area: 'personal' }, [future, now], [], today, () => '', (d) => d, (d) => d);
    expect(sections.flatMap((s) => s.tasks).map((t) => t.id)).toEqual([now.id]);
  });
});

describe('whenPatch', () => {
  it('maps choices to Postgram status and metadata', () => {
    expect(whenPatch({ kind: 'today' }, today)).toEqual({ status: 'next', metadata: { start_date: today, evening: false } });
    expect(whenPatch({ kind: 'date', date: '2026-10-10' }, today).status).toBe('scheduled');
    expect(whenPatch({ kind: 'someday' }, today)).toEqual({ status: 'someday', metadata: { start_date: null, evening: false } });
  });
});

describe('orderBetween', () => {
  it('computes midpoints and edges', () => {
    expect(orderBetween(1, 3)).toBe(2);
    expect(orderBetween(null, 5)).toBe(4);
    expect(orderBetween(5, null)).toBe(6);
  });
});
