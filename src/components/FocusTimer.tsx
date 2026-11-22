import { Check, ChevronDown, Pause, Play, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { checklist } from '../../shared/taskFields.js';
import type { Task } from '../../shared/types.js';
import { api } from '../lib/api';
import {
  DURATION_CHOICES,
  MINUTE,
  addMinutes,
  chooseMinutes,
  defaultMinutes,
  formatClock,
  fractionLeft,
  getFocus,
  pause,
  remainingMs,
  setFocus,
  settle,
  start,
  useFocus,
  wedgePath,
  type FocusState
} from '../lib/focus';
import { currentSubscription, pushSupported } from '../lib/push';
import { onTaskIdRewritten, updateTask } from '../lib/queries';
import { getLang, t, useLang } from '../i18n/index.js';
import { useUi } from './UiContext';

/** Vergrendelt alleen het scherm zolang de timer groot in beeld is en loopt. */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = () =>
      navigator.wakeLock
        .request('screen')
        .then((l) => (cancelled ? void l.release() : (lock = l)))
        .catch(() => {});
    void acquire();
    const onVisible = () => document.visibilityState === 'visible' && void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}

function useNow(ticking: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    const onVisible = () => setNow(Date.now());
    document.addEventListener('visibilitychange', onVisible);
    return () => (clearInterval(id), document.removeEventListener('visibilitychange', onVisible));
  }, [ticking]);
  return now;
}

// ---------- Geluid ----------

let audio: AudioContext | null = null;
/** Moet binnen een tik van de gebruiker gebeuren, anders blijft het geluid op iOS stil. */
function primeAudio() {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {}
}
function chime() {
  try {
    navigator.vibrate?.([200, 100, 200]);
    if (!audio) return;
    const t0 = audio.currentTime;
    [660, 880, 990].forEach((freq, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const at = t0 + i * 0.22;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.18, at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.9);
      osc.connect(gain).connect(audio!.destination);
      osc.start(at);
      osc.stop(at + 1);
    });
  } catch {}
}

// ---------- Push als de telefoon op slot is ----------

async function syncAlarm(s: FocusState | null) {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    if (s?.phase === 'running' && s.endsAt) {
      await api.scheduleFocusPush({ endpoint: sub.endpoint, endsAt: s.endsAt, title: s.title, lang: getLang() });
    } else {
      await api.cancelFocusPush(sub.endpoint);
    }
  } catch {
    // Offline of push uit: de timer in de app werkt gewoon.
  }
}

async function closeFocusNotifications() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    for (const n of (await reg?.getNotifications({ tag: 'focus' })) ?? []) n.close();
  } catch {}
}

// ---------- Weergave ----------

function Donut({ fraction, size, tone }: { fraction: number; size: number; tone: 'run' | 'pause' | 'done' }) {
  const r = size / 2;
  const fill = tone === 'pause' ? 'fill-amber-400' : 'fill-sky-500';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0">
      <circle cx={r} cy={r} r={r} className="fill-zinc-100 dark:fill-zinc-800" />
      {tone !== 'done' && <path d={wedgePath(fraction, r)} className={fill} />}
      <circle cx={r} cy={r} r={r * 0.62} style={{ fill: 'var(--surface)' }} />
    </svg>
  );
}

export function FocusTimer() {
  useLang();
  const ui = useUi();
  const focus = useFocus();
  const now = useNow(focus?.phase === 'running');
  const task = focus ? ui.tasksById.get(focus.taskId) : undefined;

  // Een offline aangemaakte taak krijgt na synchronisatie een nieuw id.
  useEffect(
    () =>
      onTaskIdRewritten((oldId, newId) => {
        const s = getFocus();
        if (s?.taskId === oldId) setFocus({ ...s, taskId: newId });
      }),
    []
  );

  // Afgelopen? Alleen een geluid als het nu gebeurt, niet bij het openen van de app een uur later.
  useEffect(() => {
    if (!focus) return;
    const next = settle(focus, now);
    if (next === focus) return;
    if (document.visibilityState === 'visible' && focus.endsAt && now - focus.endsAt < 5000) chime();
    setFocus(next);
  }, [focus, now]);

  // Server-alarm volgt de stand: lopen = gepland, anders = weg.
  const alarmKey = focus?.phase === 'running' ? `run:${focus.endsAt}` : focus ? focus.phase : 'none';
  const lastAlarm = useRef<string | null>(null);
  useEffect(() => {
    if (lastAlarm.current === alarmKey) return;
    const first = lastAlarm.current === null;
    lastAlarm.current = alarmKey;
    // Bij het laden zonder lopende timer valt er niets af te zeggen.
    if (first && !alarmKey.startsWith('run:')) return;
    // Afgelopen: de server heeft zijn melding al gestuurd.
    if (alarmKey === 'finished') return;
    void syncAlarm(getFocus());
  }, [alarmKey]);

  // Resterende tijd in de titelbalk.
  useEffect(() => {
    if (!focus || focus.phase === 'setup') return;
    const base = document.title.replace(/^[^·]*· /, '');
    document.title = focus.phase === 'finished' ? `✓ · ${base}` : `${formatClock(remainingMs(focus, now))} · ${base}`;
    return () => void (document.title = base);
  }, [focus, now]);

  const expanded = !!focus && !focus.minimized;
  useWakeLock(expanded && focus?.phase === 'running');

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      const s = getFocus();
      if (!s) return;
      setFocus(s.phase === 'setup' ? null : { ...s, minimized: true });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [expanded]);

  if (!focus) return null;

  const left = remainingMs(focus, now);
  const fraction = fractionLeft(focus, now);
  const tone = focus.phase === 'paused' ? 'pause' : focus.phase === 'finished' ? 'done' : 'run';

  if (focus.minimized) {
    return (
      <button
        type="button"
        onClick={() => setFocus({ ...focus, minimized: false })}
        aria-label={t('focus.expand')}
        className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex max-w-[70vw] -translate-x-1/2 items-center gap-2 rounded-full bg-white py-1.5 pl-1.5 pr-4 text-sm shadow-lg ring-1 ring-zinc-200 animate-fade md:max-w-md dark:bg-zinc-900 dark:ring-zinc-700"
      >
        <Donut fraction={fraction} size={26} tone={tone} />
        <span className="font-semibold tabular-nums">{formatClock(left)}</span>
        <span className="truncate text-zinc-500">{focus.title}</span>
      </button>
    );
  }

  const act = (next: FocusState | null) => {
    primeAudio();
    void closeFocusNotifications();
    setFocus(next);
  };

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={t('focus.title')}
      className="fixed inset-0 z-50 flex flex-col items-center overflow-y-auto px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] animate-fade"
      style={{ background: 'var(--surface)' }}
    >
      <div className="flex w-full max-w-md items-center justify-between">
        {focus.phase === 'setup' ? (
          <span />
        ) : (
          <button type="button" className="icon-btn size-11" onClick={() => setFocus({ ...focus, minimized: true })} aria-label={t('focus.minimize')}>
            <ChevronDown size={22} />
          </button>
        )}
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{t('focus.title')}</span>
        <button type="button" className="icon-btn size-11" onClick={() => act(null)} aria-label={t('focus.stop')}>
          <X size={20} />
        </button>
      </div>

      <div className="flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 py-6">
        <h2 className="text-center text-xl font-semibold leading-snug">{focus.title}</h2>

        <div className="relative">
          <Donut fraction={focus.phase === 'setup' ? 1 : fraction} size={240} tone={tone} />
          <div className="absolute inset-0 grid place-items-center text-center">
            {focus.phase === 'finished' ? (
              <span className="text-2xl font-bold text-sky-600 dark:text-sky-400">{t('focus.timeUp')}</span>
            ) : (
              <div>
                <div className="text-4xl font-bold tabular-nums tracking-tight">{formatClock(left)}</div>
                <div className="mt-1 text-xs text-zinc-400">
                  {focus.phase === 'paused' ? t('focus.paused') : t('focus.of', { n: Math.round(focus.durationMs / MINUTE) })}
                </div>
              </div>
            )}
          </div>
        </div>

        {focus.phase === 'finished' && <p className="text-center text-sm text-zinc-500">{t('focus.timeUpHint')}</p>}

        {focus.phase === 'setup' && <DurationChoice focus={focus} task={task} />}

        {task && focus.phase !== 'setup' && <CurrentStep task={task} />}
      </div>

      <div className="flex w-full max-w-md flex-wrap items-center justify-center gap-3">
        {focus.phase === 'setup' && (
          <button type="button" className="focus-btn focus-btn-primary w-full" onClick={() => act(start(focus, Date.now()))} autoFocus>
            <Play size={18} /> {t('focus.go')}
          </button>
        )}
        {focus.phase === 'running' && (
          <button type="button" className="focus-btn" onClick={() => act(pause(focus, Date.now()))}>
            <Pause size={18} /> {t('focus.pause')}
          </button>
        )}
        {focus.phase === 'paused' && (
          <button type="button" className="focus-btn focus-btn-primary" onClick={() => act(start(focus, Date.now()))}>
            <Play size={18} /> {t('focus.resume')}
          </button>
        )}
        {focus.phase !== 'setup' && (
          <button type="button" className="focus-btn" onClick={() => act(addMinutes(focus, 5, Date.now()))}>
            <Plus size={18} /> {t('focus.add5')}
          </button>
        )}
        {focus.phase !== 'setup' && task && task.status !== 'done' && (
          <button
            type="button"
            className={`focus-btn ${focus.phase === 'finished' ? 'focus-btn-primary' : ''}`}
            onClick={() => {
              ui.complete(task);
              act(null);
            }}
          >
            <Check size={18} /> {t('focus.done')}
          </button>
        )}
      </div>
      {focus.phase === 'setup' && pushSupported() && Notification.permission !== 'granted' && (
        <p className="mt-3 max-w-md text-center text-xs text-zinc-400">{t('focus.pushHint')}</p>
      )}
    </div>
  );
}

function DurationChoice({ focus, task }: { focus: FocusState; task: Task | undefined }) {
  const minutes = Math.round(focus.durationMs / MINUTE);
  const estimate = task && typeof task.metadata.estimate_min === 'number' ? defaultMinutes(task) : null;
  const choices = [...new Set([...(estimate ? [estimate] : []), ...DURATION_CHOICES])].sort((a, b) => a - b);
  return (
    <div className="w-full">
      <p className="mb-2 text-center text-xs text-zinc-400">{t('focus.howLong')}</p>
      <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label={t('focus.howLong')}>
        {choices.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={m === minutes}
            onClick={() => setFocus(chooseMinutes(focus, m))}
            className={`min-h-11 rounded-full px-4 text-sm font-medium ${
              m === minutes ? 'bg-sky-500 text-white' : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'
            }`}
          >
            {t('focus.minutes', { n: m })}
            {m === estimate && <span className="ml-1 text-xs opacity-75">· {t('focus.estimate')}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** De eerste open checklist-stap: één ding tegelijk. */
function CurrentStep({ task }: { task: Task }) {
  const items = checklist(task);
  const index = items.findIndex((i) => !i.done && i.text.trim());
  if (index < 0) return null;
  const step = items[index]!;
  const total = items.filter((i) => i.text.trim()).length;
  const n = items.slice(0, index + 1).filter((i) => i.text.trim()).length;
  return (
    <div className="w-full rounded-xl bg-zinc-50 p-4 dark:bg-zinc-800/60">
      <div className="mb-1 text-xs font-medium text-zinc-400">{t('focus.step', { n, total })}</div>
      <div className="flex items-center gap-3">
        <span className="flex-1 text-[15px] font-medium">{step.text}</span>
        <button
          type="button"
          className="focus-btn shrink-0 bg-white dark:bg-zinc-900"
          onClick={() => void updateTask(task, { metadata: { checklist: items.map((i) => (i.id === step.id ? { ...i, done: true } : i)) } })}
        >
          <Check size={16} /> {t('focus.stepDone')}
        </button>
      </div>
    </div>
  );
}
