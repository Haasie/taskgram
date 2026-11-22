import { describe, expect, it } from 'vitest';
import { eventsFrom, fmtTime, layoutDay, toMin, type TimelineTask } from './timeline';

const task = (id: string, minutes: number, bucket: 'work' | 'personal' = 'work'): TimelineTask => ({ id, title: id, minutes, bucket });
const base = { mode: 'normal' as const, workStart: toMin('08:30'), workEnd: toMin('17:00'), events: [] };
const tasksOf = (l: ReturnType<typeof layoutDay>) =>
  l.blocks.filter((b) => b.kind === 'task').map((b) => `${b.kind === 'task' ? b.id : ''} ${fmtTime(b.start)}-${fmtTime(b.end)}`);

describe('layoutDay', () => {
  it('places tasks in plan order from now, rounded up to five minutes', () => {
    const l = layoutDay({ ...base, now: toMin('09:02'), tasks: [task('a', 30), task('b', 45)] });
    expect(tasksOf(l)).toEqual(['a 09:05-09:35', 'b 09:35-10:20']);
  });

  it('flows around calendar events and fills a gap with a later task that fits', () => {
    const events = eventsFrom([{ title: 'Tandarts', calendar: 'Gezin', allDay: false, start: '10:00', end: '11:00' }]);
    const l = layoutDay({ ...base, now: toMin('09:00'), events, tasks: [task('a', 30), task('big', 60), task('c', 15)] });
    // a 09:00-09:30; big past niet vóór 10:00 → na de afspraak; c past nog in het gat vóór 10:00.
    expect(tasksOf(l)).toEqual(['a 09:00-09:30', 'c 09:30-09:45', 'big 11:00-12:00']);
    expect(l.blocks.find((b) => b.kind === 'event')).toMatchObject({ title: 'Tandarts', start: 600, end: 660 });
  });

  it('keeps work tasks inside the workday and personal tasks outside it', () => {
    const l = layoutDay({ ...base, now: toMin('08:00'), tasks: [task('w', 30), task('p', 30, 'personal')] });
    expect(tasksOf(l)).toEqual(['p 08:00-08:30', 'w 08:30-09:00']);
  });

  it('lets everything go anywhere on a day off', () => {
    const l = layoutDay({ ...base, mode: 'off', now: toMin('08:00'), tasks: [task('w', 30)] });
    expect(tasksOf(l)).toEqual(['w 08:00-08:30']);
  });

  it('puts what no longer fits in overflow instead of past the end of the day', () => {
    const l = layoutDay({ ...base, now: toMin('16:00'), tasks: [task('a', 45), task('b', 30), task('p', 60, 'personal')] });
    expect(tasksOf(l)).toEqual(['a 16:00-16:45', 'p 17:00-18:00']);
    expect(l.overflow.map((t) => t.id)).toEqual(['b']);
  });

  it('shows free gaps of at least 15 minutes from now on', () => {
    const events = eventsFrom([{ title: 'Call', calendar: 'Werk', allDay: false, start: '09:30', end: '09:45' }]);
    const l = layoutDay({ ...base, now: toMin('09:00'), events, tasks: [] });
    expect(l.blocks.map((b) => `${b.kind} ${fmtTime(b.start)}`)).toEqual(['free 09:00', 'event 09:30', 'free 09:45']);
  });

  it('starts planning at 07:00 when it is still night', () => {
    const l = layoutDay({ ...base, mode: 'off', now: toMin('05:13'), tasks: [task('a', 10)] });
    expect(tasksOf(l)).toEqual(['a 07:00-07:10']);
  });
});

describe('eventsFrom', () => {
  it('drops all-day events and treats an end at midnight as end of day', () => {
    const e = eventsFrom([
      { title: 'Verjaardag', calendar: 'Gezin', allDay: true, start: null, end: null },
      { title: 'Feest', calendar: 'Gezin', allDay: false, start: '21:00', end: '00:00' }
    ]);
    expect(e).toEqual([{ title: 'Feest', calendar: 'Gezin', start: 1260, end: 1440 }]);
  });
});
