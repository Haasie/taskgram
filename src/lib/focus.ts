import { useSyncExternalStore } from 'react';
import type { Task } from '../../shared/types.js';
import { t } from '../i18n/index.js';

/**
 * Focustimer. De stand is een eindtijdstip, geen teller: zo klopt de timer na herladen, een
 * slapend tabblad of een vergrendeld scherm. Eén timer tegelijk, per apparaat (localStorage).
 */
export type FocusPhase = 'setup' | 'running' | 'paused' | 'finished';

export type FocusState = {
  taskId: string;
  title: string;
  phase: FocusPhase;
  /** Totale duur inclusief verlengingen. */
  durationMs: number;
  /** Alleen tijdens `running`: wanneer de tijd om is (epoch ms). */
  endsAt: number | null;
  /** Resterende tijd bij `setup` en `paused`. */
  remainingMs: number;
  minimized: boolean;
};

export const MINUTE = 60_000;
export const DURATION_CHOICES = [5, 10, 15, 25, 45, 60, 90] as const;
export const DEFAULT_MINUTES = 25;
export const MAX_MINUTES = 240;

/** Startduur: de schatting van Dagplanning als die er is, anders 25 minuten. */
export function defaultMinutes(task: Pick<Task, 'metadata'>): number {
  const est = task.metadata.estimate_min;
  if (typeof est === 'number' && Number.isFinite(est) && est > 0) return Math.min(MAX_MINUTES, Math.round(est));
  return DEFAULT_MINUTES;
}

export function setup(taskId: string, title: string, minutes: number): FocusState {
  const ms = clampMinutes(minutes) * MINUTE;
  return { taskId, title, phase: 'setup', durationMs: ms, endsAt: null, remainingMs: ms, minimized: false };
}

export function chooseMinutes(s: FocusState, minutes: number): FocusState {
  if (s.phase !== 'setup') return s;
  const ms = clampMinutes(minutes) * MINUTE;
  return { ...s, durationMs: ms, remainingMs: ms };
}

export function remainingMs(s: FocusState, now: number): number {
  if (s.phase === 'running' && s.endsAt !== null) return Math.max(0, s.endsAt - now);
  if (s.phase === 'finished') return 0;
  return s.remainingMs;
}

/** 1 = nog alles over, 0 = op. */
export function fractionLeft(s: FocusState, now: number): number {
  return s.durationMs > 0 ? Math.min(1, remainingMs(s, now) / s.durationMs) : 0;
}

export function start(s: FocusState, now: number): FocusState {
  if (s.phase !== 'setup' && s.phase !== 'paused') return s;
  return { ...s, phase: 'running', endsAt: now + s.remainingMs };
}

export function pause(s: FocusState, now: number): FocusState {
  if (s.phase !== 'running') return s;
  return { ...s, phase: 'paused', remainingMs: remainingMs(s, now), endsAt: null };
}

/** Verlengen kan altijd; een afgelopen timer loopt dan meteen weer. */
export function addMinutes(s: FocusState, minutes: number, now: number): FocusState {
  const extra = minutes * MINUTE;
  const durationMs = Math.min(MAX_MINUTES * MINUTE, s.durationMs + extra);
  const added = durationMs - s.durationMs;
  switch (s.phase) {
    case 'running':
      return { ...s, durationMs, endsAt: (s.endsAt ?? now) + added };
    case 'finished':
      // Nieuwe ronde: de cirkel begint weer vol.
      return { ...s, phase: 'running', durationMs: extra, endsAt: now + extra, remainingMs: 0 };
    default:
      return { ...s, durationMs, remainingMs: s.remainingMs + added };
  }
}

/** Zet een verlopen timer op `finished`; geeft hetzelfde object terug als er niets verandert. */
export function settle(s: FocusState, now: number): FocusState {
  if (s.phase === 'running' && s.endsAt !== null && now >= s.endsAt) {
    return { ...s, phase: 'finished', endsAt: null, remainingMs: 0, minimized: false };
  }
  return s;
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** SVG-pad van een taartpunt die met de klok mee vanaf 12 uur `fraction` van de cirkel vult. */
export function wedgePath(fraction: number, r: number, cx = r, cy = r): string {
  const f = Math.max(0, Math.min(1, fraction));
  if (f <= 0) return '';
  if (f >= 0.9999) return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`;
  const angle = f * 2 * Math.PI;
  const x = cx + r * Math.sin(angle);
  const y = cy - r * Math.cos(angle);
  const large = f > 0.5 ? 1 : 0;
  return `M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 ${large} 1 ${x.toFixed(3)} ${y.toFixed(3)} Z`;
}

function clampMinutes(m: number): number {
  return Math.max(1, Math.min(MAX_MINUTES, Math.round(m)));
}

// ---------- Opslag ----------

const KEY = 'taskgram-focus';
const listeners = new Set<() => void>();
let current: FocusState | null = read();

function read(): FocusState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as FocusState;
    return typeof s?.taskId === 'string' && typeof s.durationMs === 'number' ? s : null;
  } catch {
    return null;
  }
}

export function getFocus(): FocusState | null {
  return current;
}

export function setFocus(next: FocusState | null): void {
  if (next === current) return;
  current = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {}
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    current = read();
    cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function useFocus(): FocusState | null {
  return useSyncExternalStore(subscribe, getFocus, () => null);
}

/**
 * Opent het instelscherm voor een taak. Loopt er al een timer voor een andere taak, dan eerst vragen;
 * voor dezelfde taak wordt de lopende timer gewoon weer groot. `minutes` overschrijft de standaardduur
 * (bijvoorbeeld de gecorrigeerde duur uit de dagtijdlijn).
 */
export function startFocus(
  task: Pick<Task, 'id' | 'metadata'>,
  title: string,
  opts: { minutes?: number; confirm?: (msg: string) => boolean } = {}
): void {
  const confirm = opts.confirm ?? ((m: string) => window.confirm(m));
  const s = getFocus();
  if (s && s.taskId === task.id) return setFocus({ ...s, minimized: false });
  if (s && s.phase !== 'setup' && !confirm(t('focus.replace', { title: s.title }))) return;
  setFocus(setup(task.id, title || t('task.untitled'), opts.minutes ?? defaultMinutes(task)));
}
