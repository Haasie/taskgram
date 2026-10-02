import { describe, expect, it } from 'vitest';
import type { Task } from './types.js';
import { completionDay } from './taskFields.js';

function makeTask(completedAtVal?: string | null, updatedAt = 'garbage'): Task {
  return {
    id: 't1',
    version: 1,
    content: 'Test task',
    status: 'done',
    tags: [],
    visibility: 'personal',
    createdAt: '2026-09-30T00:00:00.000Z',
    updatedAt,
    metadata: {
      completed_at: completedAtVal
    }
  };
}

describe('completionDay', () => {
  it("returns the date for '2026-09-30'", () => {
    const task = makeTask('2026-09-30');
    expect(completionDay(task)).toBe('2026-09-30');
  });

  it("returns the local date for '2026-09-30T10:00:00.000Z'", () => {
    const task = makeTask('2026-09-30T10:00:00.000Z');
    const expected = new Date('2026-09-30T10:00:00.000Z');
    const pad = (n: number) => String(n).padStart(2, '0');
    const localDate = `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())}`;
    expect(completionDay(task)).toBe(localDate);
  });

  it("returns null for '' and 'garbage'", () => {
    expect(completionDay(makeTask('', 'garbage'))).toBeNull();
    expect(completionDay(makeTask('garbage', 'garbage'))).toBeNull();
  });
});
