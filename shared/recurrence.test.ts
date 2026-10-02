import { describe, expect, it } from 'vitest';
import type { RecurrenceRule, Task } from './types.js';
import { describeRule, nextOccurrence, nextTaskDates } from './recurrence.js';

describe('nextOccurrence', () => {
  it('daily/1, anchor 2026-09-28, completed 2026-09-30 -> 2026-10-01', () => {
    const rule: RecurrenceRule = { type: 'daily', interval: 1 };
    expect(nextOccurrence(rule, '2026-09-28', '2026-09-30')).toBe('2026-10-01');
  });

  it('daily/3, anchor 2026-09-28, completed 2026-09-28 -> 2026-10-01', () => {
    const rule: RecurrenceRule = { type: 'daily', interval: 3 };
    expect(nextOccurrence(rule, '2026-09-28', '2026-09-28')).toBe('2026-10-01');
  });

  it('weekly/1 [1] (ma), anchor 2026-09-28 (ma), completed 2026-09-30 -> 2026-10-05', () => {
    const rule: RecurrenceRule = { type: 'weekly', interval: 1, weekdays: [1] };
    expect(nextOccurrence(rule, '2026-09-28', '2026-09-30')).toBe('2026-10-05');
  });

  it('weekly/2 [1,4], anchor 2026-09-28, completed 2026-09-28 -> 2026-10-01', () => {
    const rule: RecurrenceRule = { type: 'weekly', interval: 2, weekdays: [1, 4] };
    expect(nextOccurrence(rule, '2026-09-28', '2026-09-28')).toBe('2026-10-01');
  });

  it('weekly/2 [1,4], anchor 2026-09-28, completed 2026-10-02 -> 2026-10-12', () => {
    const rule: RecurrenceRule = { type: 'weekly', interval: 2, weekdays: [1, 4] };
    expect(nextOccurrence(rule, '2026-09-28', '2026-10-02')).toBe('2026-10-12');
  });

  it('monthly/1 day 31, anchor 2026-01-31, completed 2026-01-31 -> 2026-02-28', () => {
    const rule: RecurrenceRule = { type: 'monthly', interval: 1, day: 31 };
    expect(nextOccurrence(rule, '2026-01-31', '2026-01-31')).toBe('2026-02-28');
  });

  it('monthly/3 day 15, anchor null, completed 2026-09-30 -> 2026-12-15', () => {
    const rule: RecurrenceRule = { type: 'monthly', interval: 3, day: 15 };
    expect(nextOccurrence(rule, null, '2026-09-30')).toBe('2026-12-15');
  });

  it('after_completion 2 week, completed 2026-09-30 -> 2026-10-14', () => {
    const rule: RecurrenceRule = { type: 'after_completion', every: 2, unit: 'week' };
    expect(nextOccurrence(rule, null, '2026-09-30')).toBe('2026-10-14');
  });
});

describe('describeRule', () => {
  it('daily/1 -> "Elke dag"', () => {
    expect(describeRule({ type: 'daily', interval: 1 })).toBe('Elke dag');
  });

  it('daily/3 -> "Elke 3 dagen"', () => {
    expect(describeRule({ type: 'daily', interval: 3 })).toBe('Elke 3 dagen');
  });

  it('weekly/1 [1] -> "Elke week op ma"', () => {
    expect(describeRule({ type: 'weekly', interval: 1, weekdays: [1] })).toBe('Elke week op ma');
  });

  it('weekly/2 [1,4] -> "Elke 2 weken op ma, do"', () => {
    expect(describeRule({ type: 'weekly', interval: 2, weekdays: [1, 4] })).toBe('Elke 2 weken op ma, do');
  });

  it('monthly/1 day 15 -> "Elke maand op de 15e"', () => {
    expect(describeRule({ type: 'monthly', interval: 1, day: 15 })).toBe('Elke maand op de 15e');
  });

  it('after_completion 2 week -> "2 weken na afronden"', () => {
    expect(describeRule({ type: 'after_completion', every: 2, unit: 'week' })).toBe('2 weken na afronden');
  });

  it('after_completion 1 day -> "1 dag na afronden"', () => {
    expect(describeRule({ type: 'after_completion', every: 1, unit: 'day' })).toBe('1 dag na afronden');
  });

  describe('describeRule (en)', () => {
    it('daily/1 -> "Every day"', () => {
      expect(describeRule({ type: 'daily', interval: 1 }, 'en')).toBe('Every day');
    });

    it('daily/3 -> "Every 3 days"', () => {
      expect(describeRule({ type: 'daily', interval: 3 }, 'en')).toBe('Every 3 days');
    });

    it('weekly/1 [1] -> "Every week on Mon"', () => {
      expect(describeRule({ type: 'weekly', interval: 1, weekdays: [1] }, 'en')).toBe('Every week on Mon');
    });

    it('weekly/2 [1,4] -> "Every 2 weeks on Mon, Thu"', () => {
      expect(describeRule({ type: 'weekly', interval: 2, weekdays: [1, 4] }, 'en')).toBe('Every 2 weeks on Mon, Thu');
    });

    it('monthly/1 day 15 -> "Every month on the 15th"', () => {
      expect(describeRule({ type: 'monthly', interval: 1, day: 15 }, 'en')).toBe('Every month on the 15th');
    });

    it('after_completion 2 week -> "2 weeks after completion"', () => {
      expect(describeRule({ type: 'after_completion', every: 2, unit: 'week' }, 'en')).toBe('2 weeks after completion');
    });

    it('after_completion 1 day -> "1 day after completion"', () => {
      expect(describeRule({ type: 'after_completion', every: 1, unit: 'day' }, 'en')).toBe('1 day after completion');
    });
  });
});

describe('nextTaskDates', () => {
  const baseTask: Task = {
    id: 't1',
    version: 1,
    content: 'Test task',
    status: 'next',
    visibility: 'personal',
    tags: [],
    metadata: {},
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z'
  };

  it('start+deadline 2026-09-28/2026-09-30 with daily/1 completed 2026-09-28 -> { start_date: 2026-09-29, due_date: 2026-10-01 }', () => {
    const task: Task = {
      ...baseTask,
      metadata: {
        start_date: '2026-09-28',
        due_date: '2026-09-30',
        recurrence: { type: 'daily', interval: 1 }
      }
    };
    expect(nextTaskDates(task, '2026-09-28')).toEqual({
      start_date: '2026-09-29',
      due_date: '2026-10-01'
    });
  });

  it('deadline only 2026-09-30 weekly/1 [3] completed 2026-09-30 -> { start_date: null, due_date: 2026-10-07 }', () => {
    const task: Task = {
      ...baseTask,
      metadata: {
        due_date: '2026-09-30',
        recurrence: { type: 'weekly', interval: 1, weekdays: [3] }
      }
    };
    expect(nextTaskDates(task, '2026-09-30')).toEqual({
      start_date: null,
      due_date: '2026-10-07'
    });
  });

  it('neither, after_completion 1 day, completed 2026-09-30 -> { start_date: 2026-10-01, due_date: null }', () => {
    const task: Task = {
      ...baseTask,
      metadata: {
        recurrence: { type: 'after_completion', every: 1, unit: 'day' }
      }
    };
    expect(nextTaskDates(task, '2026-09-30')).toEqual({
      start_date: '2026-10-01',
      due_date: null
    });
  });
});
