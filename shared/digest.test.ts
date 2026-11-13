import { describe, expect, it } from 'vitest';
import type { Task } from './types.js';
import { completionDayInZone, eveningDigest, isSunday, morningDigest, pushTitle, topTasks } from './digest.js';

function task(id: string, metadata: Record<string, unknown> = {}, content = `Taak ${id}`, status: Task['status'] = 'next'): Task {
  return {
    id, version: 1, content, status, tags: [], visibility: 'personal',
    createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z', metadata
  };
}

describe('pushTitle', () => {
  it('neemt de eerste regel zonder markdown-kop en kort lange titels in', () => {
    expect(pushTitle(task('a', {}, '# Kop\nrest'))).toBe('Kop');
    const long = pushTitle(task('b', {}, 'x'.repeat(100)));
    expect(long.length).toBe(60);
    expect(long.endsWith('…')).toBe(true);
    expect(pushTitle(task('c', {}, '   '))).toBe('…');
  });
});

describe('topTasks', () => {
  it('te laat eerst, dan prioriteit, dan volgorde; max 3', () => {
    const list = [
      task('a', { start_date: '2026-09-30' }),
      task('b', { start_date: '2026-09-30', priority: 4 }),
      task('c', { due_date: '2026-09-01' }),
      task('d', { start_date: '2026-09-30' })
    ];
    expect(topTasks(list, '2026-09-30').map((t) => t.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('morningDigest', () => {
  it('enkelvoud in het Nederlands en null als er niets is', () => {
    expect(morningDigest([task('a', { start_date: '2026-09-30' }, 'Bellen')], '2026-09-30', 'nl')?.body)
      .toBe('1 taak vandaag · 0 te laat\n• Bellen');
    expect(morningDigest([task('a', { start_date: '2026-10-05' })], '2026-09-30', 'nl')).toBeNull();
  });
});

describe('eveningDigest', () => {
  it('alleen afgerond, niets voor morgen', () => {
    expect(eveningDigest([], 3, '2026-09-30', 'nl')?.body).toBe('Vandaag 3 afgerond · morgen 0 taken');
  });
  it('Engels', () => {
    const m = eveningDigest([task('a', { start_date: '2026-10-01' }, 'Call')], 1, '2026-09-30', 'en');
    expect(m).toMatchObject({ title: 'Tomorrow', body: '1 done today · tomorrow: 1 task\n• Call' });
  });
});

describe('completionDayInZone en isSunday', () => {
  it('rekent in de opgegeven tijdzone', () => {
    const t = task('a', { completed_at: '2026-09-29T22:30:00Z' }, 'x', 'done');
    expect(completionDayInZone(t, 'Europe/Amsterdam')).toBe('2026-09-30');
    expect(completionDayInZone(t, 'UTC')).toBe('2026-09-29');
    expect(completionDayInZone(task('b', { completed_at: '2026-09-30' }, 'x', 'done'), 'UTC')).toBe('2026-09-30');
  });
  it('zondag', () => {
    expect(isSunday('2026-10-04')).toBe(true);
    expect(isSunday('2026-10-05')).toBe(false);
  });
});
