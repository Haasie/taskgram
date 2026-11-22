import { describe, expect, it } from 'vitest';
import type { Task } from '../../shared/types.js';
import {
  MINUTE,
  addMinutes,
  chooseMinutes,
  defaultMinutes,
  formatClock,
  fractionLeft,
  pause,
  remainingMs,
  settle,
  setup,
  start,
  wedgePath
} from './focus';

const T0 = 1_700_000_000_000;

describe('focus timer', () => {
  it('uses the Dagplanning estimate as the default duration, else 25 minutes', () => {
    expect(defaultMinutes({ metadata: { estimate_min: 45 } })).toBe(45);
    expect(defaultMinutes({ metadata: {} })).toBe(25);
    expect(defaultMinutes({ metadata: { estimate_min: 'x' } })).toBe(25);
    expect(defaultMinutes({ metadata: { estimate_min: 999 } })).toBe(240);
  });

  it('counts down from an end time, so a sleeping tab stays correct', () => {
    const s = start(setup('t1', 'Mail', 10), T0);
    expect(s.phase).toBe('running');
    expect(remainingMs(s, T0 + 4 * MINUTE)).toBe(6 * MINUTE);
    expect(fractionLeft(s, T0 + 5 * MINUTE)).toBeCloseTo(0.5);
    expect(remainingMs(s, T0 + 60 * MINUTE)).toBe(0);
  });

  it('pauses and resumes without losing time', () => {
    let s = start(setup('t1', 'Mail', 10), T0);
    s = pause(s, T0 + 3 * MINUTE);
    expect(s.phase).toBe('paused');
    expect(remainingMs(s, T0 + 50 * MINUTE)).toBe(7 * MINUTE);
    s = start(s, T0 + 50 * MINUTE);
    expect(remainingMs(s, T0 + 51 * MINUTE)).toBe(6 * MINUTE);
  });

  it('only changes the duration during setup', () => {
    const s = chooseMinutes(setup('t1', 'Mail', 10), 45);
    expect(s.durationMs).toBe(45 * MINUTE);
    const running = start(s, T0);
    expect(chooseMinutes(running, 5)).toBe(running);
  });

  it('adds time while running, paused, and after finishing', () => {
    let s = start(setup('t1', 'Mail', 10), T0);
    s = addMinutes(s, 5, T0 + MINUTE);
    expect(remainingMs(s, T0 + MINUTE)).toBe(14 * MINUTE);
    expect(s.durationMs).toBe(15 * MINUTE);

    s = settle(s, T0 + 15 * MINUTE);
    expect(s.phase).toBe('finished');
    s = addMinutes(s, 5, T0 + 20 * MINUTE);
    expect(s.phase).toBe('running');
    expect(fractionLeft(s, T0 + 20 * MINUTE)).toBe(1);
    expect(remainingMs(s, T0 + 22 * MINUTE)).toBe(3 * MINUTE);
  });

  it('settle is a no-op until the time is up, and un-minimizes when it is', () => {
    const s = { ...start(setup('t1', 'Mail', 1), T0), minimized: true };
    expect(settle(s, T0 + 30_000)).toBe(s);
    const done = settle(s, T0 + MINUTE);
    expect(done.phase).toBe('finished');
    expect(done.minimized).toBe(false);
  });

  it('formats the clock', () => {
    expect(formatClock(25 * MINUTE)).toBe('25:00');
    expect(formatClock(61_500)).toBe('01:02');
    expect(formatClock(90 * MINUTE)).toBe('1:30:00');
    expect(formatClock(0)).toBe('00:00');
  });

  it('draws a wedge from 12 o’clock', () => {
    expect(wedgePath(0, 10)).toBe('');
    expect(wedgePath(0.25, 10)).toBe('M 10 10 L 10 0 A 10 10 0 0 1 20.000 10.000 Z');
    expect(wedgePath(0.75, 10)).toContain(' 0 1 1 ');
    expect(wedgePath(1, 10)).toMatch(/^M 10 0 A/);
  });
});

describe('startFocus', () => {
  const task = (id: string, estimate?: number): Task => ({
    id,
    version: 1,
    content: id,
    status: 'next',
    visibility: 'personal',
    tags: [],
    metadata: estimate ? { estimate_min: estimate } : {},
    createdAt: '',
    updatedAt: ''
  });

  it('opens setup with the estimate, re-expands the same task, and asks before replacing another', async () => {
    const { startFocus, getFocus, setFocus } = await import('./focus');
    setFocus(null);
    startFocus(task('a', 30), 'A');
    expect(getFocus()).toMatchObject({ taskId: 'a', phase: 'setup', durationMs: 30 * MINUTE });

    setFocus({ ...start(getFocus()!, T0), minimized: true });
    startFocus(task('a'), 'A');
    expect(getFocus()).toMatchObject({ taskId: 'a', phase: 'running', minimized: false });

    startFocus(task('b'), 'B', () => false);
    expect(getFocus()!.taskId).toBe('a');
    startFocus(task('b'), 'B', () => true);
    expect(getFocus()).toMatchObject({ taskId: 'b', phase: 'setup', durationMs: 25 * MINUTE });
    setFocus(null);
  });
});
