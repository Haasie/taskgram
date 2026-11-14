import { parseISODate, timeInZone, todayInZone } from '../../shared/dates.js';
import { checklist, deadline, isOpen, isToday, priority, sortOrder } from '../../shared/taskFields.js';
import type { Task } from '../../shared/types.js';

/**
 * Dagplanning zonder dat je zelf tijd schat.
 *
 * - Elke taak krijgt een grove duur: van AI (titel), uit een regel-heuristiek, of bijgestuurd door jou.
 * - De correctiefactor komt uit je eigen afgesloten dagplannen: gepland ÷ afgekregen. Wie structureel de helft
 *   haalt, krijgt ×2; zo wordt de planning eerlijk zonder timer of zelfkennis.
 * - Agenttaken kosten geen uitvoertijd, alleen aandacht (aftrap + review), en lopen parallel tot een grens.
 */

export type Bucket = 'work' | 'personal';
export type WorkMode = 'normal' | 'busy' | 'off';
export type Level = 'room' | 'tight' | 'over';
export type EstimateSource = 'ai' | 'rule' | 'user';

/** Afgeronde stappen waarop een schatting landt; grover kan bij ADHD niet misleiden. */
export const STEPS = [5, 10, 15, 30, 45, 60, 90, 120, 180, 240] as const;

export const snap = (min: number) =>
  STEPS.reduce((best, s) => (Math.abs(s - min) < Math.abs(best - min) ? s : best), STEPS[0] as number);

export type DayPlan = {
  id?: string;
  version?: number;
  date: string;
  planned: string[];
  /** Ruwe schatting (zonder factor) per geplande taak op het moment van plannen. */
  est: Record<string, number>;
  /** Agenttaken onder de geplande taken (aandacht i.p.v. duur). */
  agents: string[];
  workMode: WorkMode;
  /** Bewust overvol gepland: de vraag is één keer gesteld en beantwoord. */
  ackOver: boolean;
  /** Afgesloten (avond of automatisch de volgende ochtend): wat er van het plan af kwam. */
  closed: boolean;
  done: string[];
};

export type Settings = {
  workMinutes: number;
  workBusyMinutes: number;
  personalWeekdayMinutes: number;
  personalWeekendMinutes: number;
  agentAttentionMinutes: number;
  maxParallelAgents: number;
  agentTag: string;
  startFactor: number;
  /** Werktijd (HH:MM) op werkdagen: afspraken binnen dit venster gaan van Werk af, de rest van Privé. */
  workStart: string;
  workEnd: string;
};

export const DEFAULT_SETTINGS: Settings = {
  workMinutes: 300,
  workBusyMinutes: 120,
  personalWeekdayMinutes: 90,
  personalWeekendMinutes: 240,
  agentAttentionMinutes: 20,
  maxParallelAgents: 3,
  agentTag: 'agent',
  startFactor: 1.5,
  workStart: '08:30',
  workEnd: '17:00'
};

export function readSettings(raw: Record<string, unknown>): Settings {
  const num = (k: keyof Settings, min: number, max: number) => {
    const v = raw[k];
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : (DEFAULT_SETTINGS[k] as number);
  };
  const hhmm = (k: 'workStart' | 'workEnd') =>
    typeof raw[k] === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw[k] as string) ? (raw[k] as string) : DEFAULT_SETTINGS[k];
  const tag = typeof raw.agentTag === 'string' && raw.agentTag.trim() ? raw.agentTag.trim().toLowerCase() : DEFAULT_SETTINGS.agentTag;
  return {
    workMinutes: num('workMinutes', 0, 960),
    workBusyMinutes: num('workBusyMinutes', 0, 960),
    personalWeekdayMinutes: num('personalWeekdayMinutes', 0, 960),
    personalWeekendMinutes: num('personalWeekendMinutes', 0, 960),
    agentAttentionMinutes: num('agentAttentionMinutes', 5, 120),
    maxParallelAgents: num('maxParallelAgents', 1, 10),
    agentTag: tag,
    startFactor: num('startFactor', 1, 3),
    workStart: hhmm('workStart'),
    workEnd: hhmm('workEnd')
  };
}

export const isWeekend = (date: string) => {
  const d = parseISODate(date).getDay();
  return d === 0 || d === 6;
};

export const bucketOf = (t: Task): Bucket => (t.visibility === 'work' ? 'work' : 'personal');
export const isAgentTask = (t: Task, s: Settings) => t.tags.some((tag) => tag.toLowerCase() === s.agentTag);

/** Eerste regel zonder markdown-kop: het enige dat naar de AI-schatter gaat. */
export function titleOf(t: Task, max = 160): string {
  const first = (t.content ?? '').replace(/\r\n/g, '\n').split('\n')[0]?.replace(/^#+\s*/, '').trim() ?? '';
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

// ---------------------------------------------------------------- schatten

const RULES: [RegExp, number][] = [
  [/\b(snel|quick|2 ?min)\b/i, 10],
  [/\b(bel|bellen|mail|mailen|stuur|sturen|appen|app|betaal|betalen|bestel|bestellen|opzeggen|inschrijven|aanmelden|delen|doorsturen|herinner|call|email|pay|send|order|cancel)\b/i, 15],
  [/\b(check|checken|controleer|controleren|lees|lezen|kijk|bekijk|testen|test|review)\b/i, 30],
  [/\b(deelnemen|overleg|meeting|sessie|afspraak|gesprek|training|opleiding)\b/i, 60],
  [/\b(voorbereiden|voorbereiding|uitzoeken|onderzoek|onderzoeken|schrijf|schrijven|opstellen|analyse|analyseren|verwerken|uitwerken|prepare|research|write|draft)\b/i, 60],
  [/\b(bouw|bouwen|implementeren|ontwikkelen|opleveren|migreren|migratie|presentatie|herschrijven|build|implement|migrate|refactor)\b/i, 120]
];

/** Deterministische schatting: soort werkwoord, plus open checklist-punten. Geen data naar buiten. */
export function ruleEstimate(t: Task): number {
  const title = titleOf(t, 400);
  const matched = RULES.filter(([re]) => re.test(title)).map(([, min]) => min);
  const base = matched.length ? Math.max(...matched) : 30;
  const openItems = checklist(t).filter((i) => !i.done).length;
  return snap(Math.min(240, base + Math.min(120, openItems * 10)));
}

/** Schatting van de taak zelf (metadata), anders de regel. */
export function estimateOf(t: Task): { min: number; source: EstimateSource } {
  const m = t.metadata.estimate_min;
  const src = t.metadata.estimate_source;
  if (typeof m === 'number' && m > 0 && m <= 960) {
    return { min: m, source: src === 'ai' || src === 'user' ? src : 'rule' };
  }
  return { min: ruleEstimate(t), source: 'rule' };
}

/** Bijsturen met één tik: langer of korter dan gedacht. */
export function adjustEstimate(min: number, verdict: 'longer' | 'shorter'): number {
  const idx = STEPS.indexOf(snap(min) as (typeof STEPS)[number]);
  const next = verdict === 'longer' ? Math.min(STEPS.length - 1, idx + 1) : Math.max(0, idx - 1);
  return STEPS[next] as number;
}

// ---------------------------------------------------------------- historie

export const MIN_DAYS_FOR_FACTOR = 5;
export const HISTORY_DAYS = 20;

/**
 * Correctiefactor uit afgesloten dagen: Σ gepland ÷ Σ afgekregen (ruwe schattingen), begrensd op 1–3.
 * Onder MIN_DAYS_FOR_FACTOR afgesloten dagen geldt de startfactor uit de instellingen.
 */
export function correctionFactor(history: DayPlan[], s: Settings): { factor: number; days: number; learned: boolean } {
  const days = history
    .filter((p) => p.closed && p.planned.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, HISTORY_DAYS);
  if (days.length < MIN_DAYS_FOR_FACTOR) return { factor: s.startFactor, days: days.length, learned: false };
  let planned = 0;
  let done = 0;
  for (const p of days) {
    const doneSet = new Set(p.done);
    for (const id of p.planned) {
      const est = p.est[id] ?? 30;
      planned += est;
      if (doneSet.has(id)) done += est;
    }
  }
  const raw = planned / Math.max(done, 30);
  return { factor: Math.round(Math.min(3, Math.max(1, raw)) * 10) / 10, days: days.length, learned: true };
}

/** Hoe vaak een taak gepland stond zonder af te komen (afgesloten dagen, laatste 14). */
export function slipCounts(history: DayPlan[]): Map<string, number> {
  const counts = new Map<string, number>();
  const recent = history.filter((p) => p.closed).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
  for (const p of recent) {
    const done = new Set(p.done);
    for (const id of p.planned) if (!done.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export const SLIP_SPLIT = 3;

// ---------------------------------------------------------------- capaciteit

export function capacity(date: string, mode: WorkMode, s: Settings, busy: Busy = NO_BUSY): Record<Bucket, number> {
  const weekend = isWeekend(date);
  const work = mode === 'off' ? 0 : mode === 'busy' ? s.workBusyMinutes : s.workMinutes;
  const personal = weekend ? s.personalWeekendMinutes : s.personalWeekdayMinutes;
  // Bij een vrije dag valt werktijd weg, dus telt de afspraak dan helemaal voor Privé.
  const busyPersonal = mode === 'off' ? busy.personal + busy.work : busy.personal;
  return { work: Math.max(0, work - (mode === 'off' ? 0 : busy.work)), personal: Math.max(0, personal - busyPersonal) };
}

// ---------------------------------------------------------------- agenda

export type Busy = { work: number; personal: number };
export const NO_BUSY: Busy = { work: 0, personal: 0 };
export type CalItem = { start: number; end: number; allDay: boolean };

/** Uren waarin privétijd telt; afspraken 's nachts eten geen avond op. */
const AWAKE: [number, number] = [7 * 60, 23 * 60];
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Hoeveel minuten afspraken op deze dag innemen, verdeeld over het werkvenster (alleen op werkdagen) en de
 * rest van de wakkere uren. Hele-dagafspraken tellen niet (verjaardagen, vakanties); overlap telt één keer.
 */
export function busyMinutes(items: CalItem[], day: string, timeZone: string, s: Settings): Busy {
  const local = (ms: number) => {
    const d = todayInZone(new Date(ms), timeZone);
    if (d < day) return 0;
    if (d > day) return 24 * 60;
    return minutesOf(timeInZone(new Date(ms), timeZone));
  };
  const spans = items
    .filter((i) => !i.allDay && i.end > i.start)
    .map((i) => [local(i.start), local(i.end)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of spans) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  const overlap = (a: number, b: number, lo: number, hi: number) => Math.max(0, Math.min(b, hi) - Math.max(a, lo));
  const weekend = isWeekend(day);
  const [ws, we] = [minutesOf(s.workStart), minutesOf(s.workEnd)];
  let work = 0;
  let personal = 0;
  for (const [a, b] of merged) {
    const inWork = weekend ? 0 : overlap(a, b, ws, we);
    const awake = overlap(a, b, AWAKE[0], AWAKE[1]);
    const awakeInWork = weekend ? 0 : overlap(Math.max(a, AWAKE[0]), Math.min(b, AWAKE[1]), ws, we);
    work += inWork;
    personal += awake - awakeInWork;
  }
  return { work, personal };
}

export const defaultWorkMode = (date: string): WorkMode => (isWeekend(date) ? 'off' : 'normal');

export function levelOf(load: number, cap: number): Level {
  if (load === 0) return 'room';
  if (cap <= 0) return 'over';
  const r = load / cap;
  return r <= 0.85 ? 'room' : r <= 1 ? 'tight' : 'over';
}

export type LoadItem = { id: string; bucket: Bucket; agent: boolean; raw: number; minutes: number; source: EstimateSource };
export type BucketLoad = { load: number; capacity: number; level: Level; count: number };
export type Load = {
  factor: number;
  items: LoadItem[];
  buckets: Record<Bucket, BucketLoad>;
  agents: number;
  agentsOver: boolean;
  over: boolean;
};

/** Belasting van een set taken: (agent ? aandacht : duur) × factor, per balk. */
export function loadOf(tasks: Task[], date: string, mode: WorkMode, factor: number, s: Settings, busy: Busy = NO_BUSY): Load {
  const cap = capacity(date, mode, s, busy);
  const items = tasks.map((t): LoadItem => {
    const agent = isAgentTask(t, s);
    const est = estimateOf(t);
    const raw = agent ? s.agentAttentionMinutes : est.min;
    return { id: t.id, bucket: bucketOf(t), agent, raw, minutes: Math.round(raw * factor), source: est.source };
  });
  const sum = (b: Bucket) => items.filter((i) => i.bucket === b).reduce((n, i) => n + i.minutes, 0);
  const count = (b: Bucket) => items.filter((i) => i.bucket === b).length;
  const buckets = {
    work: { load: sum('work'), capacity: cap.work, level: levelOf(sum('work'), cap.work), count: count('work') },
    personal: { load: sum('personal'), capacity: cap.personal, level: levelOf(sum('personal'), cap.personal), count: count('personal') }
  };
  const agents = items.filter((i) => i.agent).length;
  const agentsOver = agents > s.maxParallelAgents;
  return { factor, items, buckets, agents, agentsOver, over: buckets.work.level === 'over' || buckets.personal.level === 'over' || agentsOver };
}

// ---------------------------------------------------------------- voorstel

const late = (t: Task, today: string) => ((deadline(t) ?? '9999-12-31') < today ? 0 : 1);
const byUrgency = (today: string) => (a: Task, b: Task) =>
  late(a, today) - late(b, today) || priority(b) - priority(a) || sortOrder(a) - sortOrder(b);

/**
 * Kandidaten voor vandaag, in drie groepen:
 * - leftovers: stond gisteren gepland, niet af, staat nog open
 * - today: wat de lijst Vandaag nu toont (start ≤ vandaag of deadline bereikt)
 * - extra: open taken met prioriteit ≥ 3 of favoriet die (nog) niet op Vandaag staan
 * Inbox blijft buiten: alleen het aantal, zodat een volle inbox de ochtend niet platslaat.
 */
export function candidates(tasks: Task[], today: string, previous: DayPlan | null) {
  const open = tasks.filter(isOpen);
  const prevMissed = new Set(previous ? previous.planned.filter((id) => !previous.done.includes(id)) : []);
  const leftovers = open.filter((t) => prevMissed.has(t.id) && t.status !== 'inbox').sort(byUrgency(today));
  const leftIds = new Set(leftovers.map((t) => t.id));
  const todays = open.filter((t) => !leftIds.has(t.id) && t.status !== 'inbox' && isToday(t, today)).sort(byUrgency(today));
  const todayIds = new Set(todays.map((t) => t.id));
  const extra = open
    .filter(
      (t) =>
        !leftIds.has(t.id) &&
        !todayIds.has(t.id) &&
        (t.status === 'next' || t.status === 'active') &&
        (priority(t) >= 3 || t.metadata.favorite === true)
    )
    .sort(byUrgency(today))
    .slice(0, 12);
  const inbox = open.filter((t) => t.status === 'inbox').length;
  return { leftovers, today: todays, extra, inbox };
}

/**
 * Voorselectie: eerst wat al op Vandaag staat (op urgentie), zolang het binnen de capaciteit past.
 * Taken met een verlopen deadline gaan altijd mee. Gisteren-gemist kies je zelf: dat voelt anders dan opnieuw krijgen.
 */
export function suggest(
  tasks: Task[],
  today: string,
  mode: WorkMode,
  factor: number,
  s: Settings,
  busy: Busy = NO_BUSY
): string[] {
  const cap = capacity(today, mode, s, busy);
  const used: Record<Bucket, number> = { work: 0, personal: 0 };
  let agents = 0;
  const picked: string[] = [];
  for (const t of [...tasks].sort(byUrgency(today))) {
    const agent = isAgentTask(t, s);
    const minutes = Math.round((agent ? s.agentAttentionMinutes : estimateOf(t).min) * factor);
    const b = bucketOf(t);
    const forced = late(t, today) === 0;
    if (agent && agents >= s.maxParallelAgents && !forced) continue;
    if (!forced && used[b] + minutes > cap[b]) continue;
    used[b] += minutes;
    if (agent) agents += 1;
    picked.push(t.id);
  }
  return picked;
}

export const fmtMinutes = (min: number, lang: 'nl' | 'en' = 'nl') => {
  const hour = lang === 'en' ? 'h' : 'u';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}${hour} ${m}m` : `${h}${hour}`;
};
