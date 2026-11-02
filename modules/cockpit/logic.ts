/**
 * Omzetten van Postgram `GET /api/where` naar wat de Cockpit toont.
 * Alleen de velden die de weergave nodig heeft gaan naar de browser; transcript-paden en
 * agent-sessie-id's blijven op de server.
 */

export const STAGES = ['building', 'review', 'functional_test', 'ready_to_merge', 'awaiting_release', 'released'] as const;
export type Stage = (typeof STAGES)[number];

export const RISKS = ['dirty', 'unpushed', 'no_upstream', 'interrupted', 'missing'] as const;
export type Risk = (typeof RISKS)[number];

export type Level = 'ok' | 'warn' | 'alert';

export type CockpitWorkspace = {
  id: string;
  machine: string;
  path: string;
  repo: string | null;
  branch: string | null;
  lastActivityAt: string | null;
  dirty: number | null;
  unpushed: number | null;
  hasUpstream: boolean | null;
  missingSince: string | null;
  risks: Risk[];
  level: Level;
  /** Lopende of slapende agent-sessies op deze werkplek. */
  sessions: { agent: string; status: string; lastActivityAt: string | null }[];
  /** Commando om de laatste agent-sessie te hervatten, als die er is. */
  resume: string | null;
};

export type CockpitFeature = {
  id: string;
  title: string;
  stage: Stage | null;
  taskStatus: string | null;
  pullRequests: { url: string; state: string }[];
  workspaces: CockpitWorkspace[];
  level: Level;
};

export type CockpitGroup = { key: string; label: string; features: CockpitFeature[] };

export type Cockpit = {
  generatedAt: string | null;
  groups: CockpitGroup[];
  unassigned: CockpitWorkspace[];
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

/** Ontbrekende werkplek of afgebroken sessie = alarm; lokaal werk dat niet op de remote staat = let op. */
export function levelOf(risks: readonly Risk[]): Level {
  if (risks.includes('missing') || risks.includes('interrupted')) return 'alert';
  return risks.length ? 'warn' : 'ok';
}

const worst = (levels: Level[]): Level => (levels.includes('alert') ? 'alert' : levels.includes('warn') ? 'warn' : 'ok');

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function resumeCommand(path: string, session: Obj): string | null {
  const id = str(session.agent_session_id);
  if (!path || !id) return null;
  if (session.agent_kind === 'claude-code') return `cd ${quote(path)} && claude --resume ${quote(id)}`;
  return null;
}

export function toWorkspace(raw: unknown): CockpitWorkspace {
  const w = obj(raw);
  const git = obj(w.git);
  const path = str(w.path) ?? '';
  const risks = arr(w.risks).filter((r): r is Risk => (RISKS as readonly unknown[]).includes(r));
  const resume = w.resume_session ? resumeCommand(path, obj(w.resume_session)) : null;
  return {
    id: str(w.id) ?? path,
    machine: str(w.machine) ?? '?',
    path,
    repo: str(w.repo_remote),
    branch: str(w.branch),
    lastActivityAt: str(w.last_activity_at),
    dirty: num(git.dirty_count),
    unpushed: num(git.unpushed_count),
    hasUpstream: bool(git.has_upstream),
    missingSince: str(w.missing_since),
    risks,
    level: levelOf(risks),
    sessions: arr(w.sessions)
      .map(obj)
      .map((s) => ({ agent: str(s.agent_kind) ?? 'other', status: str(s.status) ?? '?', lastActivityAt: str(s.last_activity_at) })),
    resume
  };
}

export function toFeature(raw: unknown): CockpitFeature {
  const f = obj(raw);
  const stage = (STAGES as readonly unknown[]).includes(f.stage) ? (f.stage as Stage) : null;
  const workspaces = arr(f.workspaces).map(toWorkspace);
  return {
    id: str(f.id) ?? '',
    title: str(f.title) ?? '—',
    stage,
    taskStatus: str(f.task_status),
    pullRequests: arr(f.pull_requests)
      .map(obj)
      .filter((p) => str(p.url)?.startsWith('https://'))
      .map((p) => ({ url: str(p.url)!, state: str(p.state) ?? '?' })),
    workspaces,
    level: worst(workspaces.map((w) => w.level))
  };
}

export function toCockpit(raw: unknown): Cockpit {
  const body = obj(raw);
  const groups: CockpitGroup[] = [];
  let unassigned: CockpitWorkspace[] = [];
  for (const g of arr(body.groups).map(obj)) {
    if (g.key === 'unassigned') {
      unassigned = arr(g.workspaces).map(toWorkspace);
      continue;
    }
    groups.push({ key: str(g.key) ?? '?', label: str(g.label) ?? '?', features: arr(g.features).map(toFeature) });
  }
  return { generatedAt: str(body.generated_at), groups, unassigned };
}

/** Tellers bovenaan: werkplekken met een risico, per soort. */
export function riskCounts(c: Cockpit): Record<Risk, number> {
  const counts = Object.fromEntries(RISKS.map((r) => [r, 0])) as Record<Risk, number>;
  const all = [...c.groups.flatMap((g) => g.features.flatMap((f) => f.workspaces)), ...c.unassigned];
  for (const w of all) for (const r of w.risks) counts[r] += 1;
  return counts;
}
