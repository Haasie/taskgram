import { describe, expect, it } from 'vitest';
import { timeInZone, todayInZone } from './dates.js';

describe('zone helpers', () => {
  it('uses the target zone, not UTC', () => {
    const now = new Date('2026-09-30T22:30:00Z'); // 00:30 on 1 Oct in Amsterdam (CEST)
    expect(todayInZone(now, 'Europe/Amsterdam')).toBe('2026-10-01');
    expect(timeInZone(now, 'Europe/Amsterdam')).toBe('00:30');
    expect(todayInZone(now, 'UTC')).toBe('2026-09-30');
  });
});
