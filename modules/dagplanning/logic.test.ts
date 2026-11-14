import { describe, expect, it } from 'vitest';
import type { Task } from '../../shared/types.js';
import {
  adjustEstimate,
  candidates,
  correctionFactor,
  DEFAULT_SETTINGS,
  estimateOf,
  levelOf,
  loadOf,
  readSettings,
  ruleEstimate,
  slipCounts,
  snap,
  suggest,
  type DayPlan
} from './logic.js';

const TODAY = '2026-11-16'; // maandag
let n = 0;
function task(content: string, extra: Partial<Task> & { metadata?: Task['metadata'] } = {}): Task {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    version: 1,
    content,
    status: 'next',
    visibility: 'work',
    tags: [],
    createdAt: '2026-11-01T08:00:00Z',
    updatedAt: '2026-11-01T08:00:00Z',
    ...extra,
    metadata: { start_date: TODAY, ...(extra.metadata ?? {}) }
  };
}
const plan = (date: string, planned: string[], done: string[], est = 60): DayPlan => ({
  date,
  planned,
  done,
  est: Object.fromEntries(planned.map((id) => [id, est])),
  agents: [],
  workMode: 'normal',
  ackOver: false,
  closed: true
});

describe('schatten zonder zelf te schatten', () => {
  it('rondt af op vaste stappen', () => {
    expect(snap(37)).toBe(30);
    expect(snap(200)).toBe(180);
    expect(snap(1)).toBe(5);
  });

  it('regel: soort werkwoord bepaalt de grove duur, het zwaarste wint', () => {
    expect(ruleEstimate(task('Erik bellen'))).toBe(15);
    expect(ruleEstimate(task('Rapport reviewen'))).toBe(30);
    expect(ruleEstimate(task('Tabletop voorbereiden en mailen'))).toBe(60);
    expect(ruleEstimate(task('Demo opleveren aan het team'))).toBe(120);
    expect(ruleEstimate(task('Iets zonder werkwoord'))).toBe(30);
  });

  it('regel: open checklist-punten tellen mee', () => {
    const t = task('Boodschappen', { metadata: { checklist: [1, 2, 3].map((i) => ({ id: `c${i}`, text: 'x', done: false })) } });
    expect(ruleEstimate(t)).toBe(60);
  });

  it('een schatting op de taak gaat voor op de regel', () => {
    expect(estimateOf(task('Erik bellen', { metadata: { estimate_min: 45, estimate_source: 'ai' } }))).toEqual({ min: 45, source: 'ai' });
    expect(estimateOf(task('Erik bellen'))).toEqual({ min: 15, source: 'rule' });
  });

  it('bijsturen schuift één stap', () => {
    expect(adjustEstimate(30, 'longer')).toBe(45);
    expect(adjustEstimate(30, 'shorter')).toBe(15);
    expect(adjustEstimate(240, 'longer')).toBe(240);
    expect(adjustEstimate(5, 'shorter')).toBe(5);
  });
});

describe('correctie uit je eigen dagplannen', () => {
  it('gebruikt de startfactor tot er vijf afgesloten dagen zijn', () => {
    const f = correctionFactor([plan('2026-11-10', ['a'], ['a'])], DEFAULT_SETTINGS);
    expect(f).toEqual({ factor: 1.5, days: 1, learned: false });
  });

  it('gepland ÷ afgekregen: wie de helft haalt krijgt ×2', () => {
    const days = ['10', '11', '12', '13', '14'].map((d) => plan(`2026-11-${d}`, ['a', 'b'], ['a']));
    expect(correctionFactor(days, DEFAULT_SETTINGS)).toEqual({ factor: 2, days: 5, learned: true });
  });

  it('begrensd op 1 tot 3, ook als je niets of alles afkrijgt', () => {
    const all = ['10', '11', '12', '13', '14'].map((d) => plan(`2026-11-${d}`, ['a'], ['a']));
    const none = ['10', '11', '12', '13', '14'].map((d) => plan(`2026-11-${d}`, ['a', 'b', 'c', 'd', 'e'], []));
    expect(correctionFactor(all, DEFAULT_SETTINGS).factor).toBe(1);
    expect(correctionFactor(none, DEFAULT_SETTINGS).factor).toBe(3);
  });

  it('telt doorschuiven per taak', () => {
    const slips = slipCounts([plan('2026-11-12', ['a', 'b'], ['b']), plan('2026-11-13', ['a'], []), plan('2026-11-14', ['a'], [])]);
    expect(slips.get('a')).toBe(3);
    expect(slips.get('b')).toBeUndefined();
  });
});

describe('capaciteit en belasting', () => {
  it('status in drie woorden', () => {
    expect(levelOf(0, 0)).toBe('room');
    expect(levelOf(200, 300)).toBe('room');
    expect(levelOf(280, 300)).toBe('tight');
    expect(levelOf(301, 300)).toBe('over');
    expect(levelOf(30, 0)).toBe('over');
  });

  it('agenttaken kosten alleen aandacht en hebben een grens', () => {
    const s = readSettings({ maxParallelAgents: 2 });
    const tasks = [1, 2, 3].map((i) => task(`Feature ${i} bouwen`, { tags: ['agent'] }));
    const load = loadOf(tasks, TODAY, 'normal', 1, s);
    expect(load.buckets.work.load).toBe(60); // 3 × 20 min aandacht, geen 3 × 120 min bouwen
    expect(load.agentsOver).toBe(true);
    expect(load.over).toBe(true);
  });

  it('werk en privé zijn aparte balken; het weekend heeft standaard geen werktijd', () => {
    const tasks = [task('Erik bellen', { visibility: 'personal' }), task('Mail sturen')];
    const load = loadOf(tasks, '2026-11-14', 'off', 1, DEFAULT_SETTINGS);
    expect(load.buckets.personal).toMatchObject({ load: 15, capacity: 240, level: 'room' });
    expect(load.buckets.work).toMatchObject({ load: 15, capacity: 0, level: 'over' });
  });

  it('de factor rekent mee', () => {
    const load = loadOf([task('Rapport reviewen')], TODAY, 'normal', 2, DEFAULT_SETTINGS);
    expect(load.buckets.work.load).toBe(60);
  });
});

describe('voorstel voor de ochtend', () => {
  it('kiest op urgentie tot de capaciteit vol is; te laat gaat altijd mee', () => {
    const s = readSettings({ workMinutes: 120 });
    const late = task('Iets dat te laat is', { metadata: { due_date: '2026-11-10', estimate_min: 240 } });
    const high = task('Belangrijk bouwen', { metadata: { priority: 5, estimate_min: 90 } });
    const low = task('Klein klusje', { metadata: { estimate_min: 30 } });
    const picked = suggest([low, high, late], TODAY, 'normal', 1, s);
    expect(picked).toEqual([late.id]);
  });

  it('kandidaten: gisteren-gemist apart, inbox alleen als aantal', () => {
    const missed = task('Gisteren gemist', { metadata: { start_date: '2026-11-15' } });
    const todays = task('Vandaag');
    const fav = task('Favoriet', { metadata: { start_date: null, favorite: true } });
    const inbox = task('Inbox-ding', { status: 'inbox', metadata: { start_date: null } });
    const c = candidates([missed, todays, fav, inbox], TODAY, plan('2026-11-15', [missed.id], []));
    expect(c.leftovers.map((t) => t.id)).toEqual([missed.id]);
    expect(c.today.map((t) => t.id)).toEqual([todays.id]);
    expect(c.extra.map((t) => t.id)).toEqual([fav.id]);
    expect(c.inbox).toBe(1);
  });
});
