import type { RawEntity } from '../../server/postgram.js';
import type { DayPlan, WorkMode } from './logic.js';

/**
 * Een dagplan is een Postgram-document met tag `dagplan` (zelfde patroon als het Leesdossier).
 * De inhoud is bewust kaal: alleen datum en aantallen, geen taaktitels. Zo komen werktitels niet
 * nog een keer in een tweede entity terecht; de koppeling zit in metadata (taak-id's).
 */
export const PLAN_TAG = 'dagplan';

const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const MODES: WorkMode[] = ['normal', 'busy', 'off'];

export function planFromEntity(e: RawEntity): DayPlan | null {
  const m = (e.metadata ?? {}) as Record<string, unknown>;
  if (typeof m.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(m.date)) return null;
  const est: Record<string, number> = {};
  if (m.est && typeof m.est === 'object') {
    for (const [k, v] of Object.entries(m.est as Record<string, unknown>)) if (typeof v === 'number') est[k] = v;
  }
  return {
    id: e.id,
    version: e.version,
    date: m.date,
    planned: ids(m.planned),
    est,
    agents: ids(m.agents),
    workMode: MODES.includes(m.work_mode as WorkMode) ? (m.work_mode as WorkMode) : 'normal',
    ackOver: m.ack_over === true,
    closed: m.closed === true,
    done: ids(m.done)
  };
}

export function planContent(p: DayPlan): string {
  const head = `# Dagplan ${p.date}`;
  const line = p.closed ? `${p.planned.length} gepland, ${p.done.length} af.` : `${p.planned.length} gepland.`;
  return `${head}\n\n${line}`;
}

export function planMetadata(p: DayPlan) {
  return {
    date: p.date,
    planned: p.planned,
    est: p.est,
    agents: p.agents,
    work_mode: p.workMode,
    ack_over: p.ackOver,
    closed: p.closed,
    done: p.done
  };
}
