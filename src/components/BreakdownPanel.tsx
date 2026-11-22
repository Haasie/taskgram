import { useQuery } from '@tanstack/react-query';
import { Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useSyncStatus } from '../lib/sync';
import { getLang, t, useLang } from '../i18n/index.js';

/** Is de AI-opknipper op deze server ingericht? Onbekend of offline = nee, dan geen knop. */
export function useBreakdownAvailable(): boolean {
  const q = useQuery({ queryKey: ['ai-status'], queryFn: api.aiStatus, staleTime: 10 * 60_000, retry: false });
  return q.data?.breakdown === true;
}

type Proposal = { text: string; keep: boolean };
type State = { kind: 'loading' } | { kind: 'error'; offline: boolean } | { kind: 'ready'; steps: Proposal[] };

/**
 * Voorstel voor kleine stapjes. Niets komt in de taak zonder dat je op *Toevoegen* tikt; je kunt stappen
 * aanpassen of weglaten.
 */
export function BreakdownPanel({ title, onAdd, onClose }: { title: string; onAdd: (steps: string[]) => void; onClose: () => void }) {
  useLang();
  const { online } = useSyncStatus();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!online) return setState({ kind: 'error', offline: true });
    let cancelled = false;
    setState({ kind: 'loading' });
    api
      .breakdown(title, getLang())
      .then((r) => !cancelled && setState({ kind: 'ready', steps: r.steps.map((text) => ({ text, keep: true })) }))
      .catch(() => !cancelled && setState({ kind: 'error', offline: false }));
    return () => void (cancelled = true);
  }, [title, online, round]);

  const edit = (i: number, patch: Partial<Proposal>) =>
    setState((s) => (s.kind === 'ready' ? { ...s, steps: s.steps.map((p, j) => (j === i ? { ...p, ...patch } : p)) } : s));
  const chosen = state.kind === 'ready' ? state.steps.filter((p) => p.keep && p.text.trim()).map((p) => p.text.trim()) : [];

  return (
    <section aria-label={t('breakdown.title')} className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-900 dark:bg-violet-950/30">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
        <Sparkles size={13} /> {t('breakdown.title')}
      </div>

      {state.kind === 'loading' && (
        <p className="flex items-center gap-2 py-2 text-sm text-zinc-500" role="status">
          <Loader2 size={15} className="animate-spin" /> {t('breakdown.loading')}
        </p>
      )}

      {state.kind === 'error' && <p className="py-1 text-sm text-zinc-600 dark:text-zinc-300">{t(state.offline ? 'breakdown.offline' : 'breakdown.failed')}</p>}

      {state.kind === 'ready' && (
        <ul className="space-y-1">
          {state.steps.map((p, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={p.keep}
                onChange={(e) => edit(i, { keep: e.target.checked })}
                aria-label={t('breakdown.keep', { step: p.text })}
                className="size-4 shrink-0 accent-violet-600"
              />
              <input
                value={p.text}
                onChange={(e) => edit(i, { text: e.target.value })}
                className={`min-w-0 flex-1 bg-transparent py-1 text-sm outline-none ${p.keep ? '' : 'text-zinc-400 line-through'}`}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {state.kind === 'ready' && (
          <button type="button" className="btn btn-primary bg-violet-600 hover:bg-violet-700 dark:hover:bg-violet-700" disabled={!chosen.length} onClick={() => onAdd(chosen)}>
            {t('breakdown.add', { n: chosen.length })}
          </button>
        )}
        {state.kind !== 'loading' && online && (
          <button type="button" className="btn inline-flex items-center gap-1.5" onClick={() => setRound((r) => r + 1)}>
            <RotateCcw size={14} /> {t('breakdown.again')}
          </button>
        )}
        <button type="button" className="btn ml-auto text-zinc-500" onClick={onClose}>
          {t('breakdown.cancel')}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-zinc-400">{t('breakdown.privacy')}</p>
    </section>
  );
}
