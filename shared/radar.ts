import type { Project, Task, TaskStatus, Visibility } from './types.js';
import { isOpen, projectId } from './taskFields.js';
import { daysBetween } from './dates.js';

/**
 * Radar: een overzicht per gebied (werk/privé) van projectkaarten in Postgram.
 * Een projectkaart is een Postgram-project met tag `werkradar` of `priveradar`;
 * de velden staan in metadata (code, naam, fase, rag, volgende_stap, extern, deadline, risico, sort).
 */
export const RADAR_TAG: Record<Visibility, string | null> = {
  work: 'werkradar',
  personal: 'priveradar',
  shared: null
};

export const RAG_VALUES = ['rood', 'oranje', 'groen'] as const;
export type Rag = (typeof RAG_VALUES)[number];

export type RadarMeta = {
  code: string | null;
  naam: string | null;
  spoor: string | null;
  fase: string | null;
  rag: Rag | null;
  volgende_stap: string | null;
  extern: string | null;
  deadline: string | null;
  risico: string | null;
  sort: number | null;
};

/** Velden die vanuit de app bewerkt mogen worden. */
export const RADAR_EDITABLE = ['fase', 'rag', 'volgende_stap', 'extern', 'deadline', 'risico'] as const;
export type RadarPatch = Partial<Pick<RadarMeta, (typeof RADAR_EDITABLE)[number]>>;

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

export function radarMeta(p: Pick<Project, 'metadata'>): RadarMeta {
  const m = p.metadata ?? {};
  const rag = str(m.rag);
  const sort = typeof m.sort === 'number' ? m.sort : Number.isFinite(Number(m.sort)) && m.sort != null ? Number(m.sort) : null;
  const deadline = str(m.deadline);
  return {
    code: str(m.code),
    naam: str(m.naam),
    spoor: str(m.spoor),
    fase: str(m.fase),
    rag: rag && (RAG_VALUES as readonly string[]).includes(rag) ? (rag as Rag) : null,
    volgende_stap: str(m.volgende_stap),
    extern: str(m.extern),
    deadline: deadline && /^\d{4}-\d{2}-\d{2}/.test(deadline) ? deadline.slice(0, 10) : null,
    risico: str(m.risico),
    sort
  };
}

export function isRadarProject(p: Pick<Project, 'tags' | 'visibility' | 'status'>, area?: Visibility): boolean {
  if (p.status === 'done' || p.status === 'archived') return false;
  const tags = p.tags ?? [];
  if (area) {
    const tag = RADAR_TAG[area];
    return !!tag && tags.includes(tag);
  }
  return tags.includes('werkradar') || tags.includes('priveradar');
}

export function radarProjects(projects: Project[], area: Visibility): Project[] {
  return projects.filter((p) => isRadarProject(p, area));
}

const RAG_ORDER: Record<Rag, number> = { rood: 0, oranje: 1, groen: 2 };

/** Deadline eerst (vroegste boven), dan rood · oranje · groen, dan de eigen volgorde. */
export function rankRadar(projects: Project[]): Project[] {
  return projects
    .map((p) => ({ p, m: radarMeta(p) }))
    .sort((a, b) => {
      const da = a.m.deadline ?? '9999-12-31';
      const db = b.m.deadline ?? '9999-12-31';
      if (da !== db) return da.localeCompare(db);
      const ra = a.m.rag ? RAG_ORDER[a.m.rag] : 3;
      const rb = b.m.rag ? RAG_ORDER[b.m.rag] : 3;
      if (ra !== rb) return ra - rb;
      return (a.m.sort ?? 99) - (b.m.sort ?? 99) || (a.m.code ?? '').localeCompare(b.m.code ?? '');
    })
    .map((x) => x.p);
}

export const RADAR_STATUSES = ['active', 'next', 'waiting', 'scheduled', 'inbox', 'someday'] as const satisfies readonly TaskStatus[];
export type RadarCounts = Record<(typeof RADAR_STATUSES)[number], number> & { open: number; total: number };

export function emptyCounts(): RadarCounts {
  return { active: 0, next: 0, waiting: 0, scheduled: 0, inbox: 0, someday: 0, open: 0, total: 0 };
}

function add(c: RadarCounts, t: Task) {
  const s = t.status as (typeof RADAR_STATUSES)[number];
  if (s in c) c[s] += 1;
  c.total += 1;
  if (t.status !== 'someday') c.open += 1;
}

/** Open taken per radarproject. Taken van andere projecten met een `part_of`-ouder vallen hier niet onder. */
export function countsByProject(tasks: Task[]): Map<string, RadarCounts> {
  const out = new Map<string, RadarCounts>();
  for (const t of tasks) {
    if (!isOpen(t)) continue;
    const pid = projectId(t);
    if (!pid) continue;
    if (!out.has(pid)) out.set(pid, emptyCounts());
    add(out.get(pid)!, t);
  }
  return out;
}

export function ageInDays(createdAt: string, today: string): number {
  return daysBetween(createdAt.slice(0, 10), today);
}

export type RadarSummary = RadarCounts & {
  /** Open taken in dit gebied zonder radarproject. */
  unassigned: number;
  /** Inbox-taken in dit gebied ouder dan `staleDays`. */
  stale: number;
};

export function radarSummary(tasks: Task[], projects: Project[], area: Visibility, today: string, staleDays = 28): RadarSummary {
  const known = new Set(projects.map((p) => p.id));
  const sum: RadarSummary = { ...emptyCounts(), unassigned: 0, stale: 0 };
  for (const t of tasks) {
    if (!isOpen(t) || t.visibility !== area) continue;
    add(sum, t);
    const pid = projectId(t);
    if ((!pid || !known.has(pid)) && t.status !== 'someday') sum.unassigned += 1;
    if (t.status === 'inbox' && ageInDays(t.createdAt, today) > staleDays) sum.stale += 1;
  }
  return sum;
}

/** Dagen tot de deadline (negatief = verlopen), of null. */
export function daysLeft(deadline: string | null, today: string): number | null {
  return deadline ? daysBetween(today, deadline) : null;
}

/** Display-titel voor een radarkaart: "P01 Voorbeeld — projectnaam". */
export function radarTitle(p: Project, fallback: (p: Project) => string): string {
  const m = radarMeta(p);
  if (m.code && m.naam) return `${m.code} ${m.naam}`;
  return fallback(p);
}
