import '../_design';
import './dagplanning.css';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, request } from '../../src/lib/api';
import { queryClient } from '../../src/lib/queries';
import type { ModuleViewProps } from '../types';
import { useT } from './i18n';
import { fmtMinutes, levelOf, type Bucket, type Level, type WorkMode } from './logic';

// Status altijd met vorm én woord, nooit alleen kleur.
const MARK: Record<Level, string> = { room: '●', tight: '▲', over: '■' };
type Move = 'today' | 'tomorrow' | 'later' | 'someday';

type Item = {
  id: string;
  version: number;
  title: string;
  bucket: Bucket;
  agent: boolean;
  estimate: number;
  source: 'ai' | 'rule' | 'user';
  deadline: string | null;
  priority: number;
  status: string;
  slips: number;
  split: boolean;
};

type Day = {
  date: string;
  plan: { planned: string[]; workMode: WorkMode; ackOver: boolean; closed: boolean; done: string[] } | null;
  suggested: string[] | null;
  workMode: WorkMode;
  factor: { factor: number; days: number; learned: boolean };
  settings: { agentAttentionMinutes: number; maxParallelAgents: number; capacity: Record<WorkMode, Record<Bucket, number>> };
  ai: boolean;
  missingEstimates: number;
  leftovers: Item[];
  today: Item[];
  extra: Item[];
  planned: Item[];
  inbox: number;
};

type I18n = ReturnType<typeof useT>;

const dayKey = (date: string) => ['module', 'dagplanning', 'day', date] as const;
const refreshTasks = () => void queryClient.invalidateQueries({ queryKey: ['tasks'] });

export default function DagplanningView({ today }: ModuleViewProps) {
  const i18n = useT();
  const { t } = i18n;
  const q = useQuery({ queryKey: dayKey(today), queryFn: () => request<Day>('GET', `/modules/dagplanning/day?date=${today}`) });
  const data = q.data;
  const [tab, setTab] = useState<'morning' | 'evening' | null>(null);
  // Standaard: avond zodra er een plan is en het na vieren is; anders ochtend.
  const autoTab = data?.plan && !data.plan.closed && new Date().getHours() >= 16 ? 'evening' : 'morning';
  const active = tab ?? autoTab;

  return (
    <div className="ld dp">
      <div className="ld-wrap">
        <header className="ld-head">
          <div className="ld-top">
            <div>
              <div className="ld-label">{t('kicker')}</div>
              <h1 className="ld-h1">
                {t('title')}
                <span className="ld-cur" aria-hidden="true" />
              </h1>
              <p className="ld-sub">{new Date(`${today}T12:00:00`).toLocaleDateString(i18n.locale, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            </div>
            <div className="ld-bar" role="tablist">
              {(['morning', 'evening'] as const).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={active === k} className={`ld-btn ld-sm ${active === k ? '' : 'ld-sec'}`} onClick={() => setTab(k)}>
                  {t(k)}
                </button>
              ))}
            </div>
          </div>
        </header>
        {q.isLoading ? (
          <div className="ld-empty">{t('loading')}</div>
        ) : q.isError ? (
          <div className="ld-empty ld-error" role="alert">
            {t('loadFailed', { error: q.error.message })}
          </div>
        ) : data ? (
          active === 'morning' ? (
            <Morning key={data.date} day={data} i18n={i18n} />
          ) : (
            <Evening day={data} i18n={i18n} onPlan={() => setTab('morning')} />
          )
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ochtend

function Morning({ day, i18n }: { day: Day; i18n: I18n }) {
  const { t } = i18n;
  const [mode, setMode] = useState<WorkMode>(day.workMode);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(day.plan?.planned ?? day.suggested ?? []));
  const [moves, setMoves] = useState<Record<string, Move>>({});
  const [showExtra, setShowExtra] = useState(false);
  const [askOver, setAskOver] = useState(false);
  const [result, setResult] = useState<{ failed: number } | null>(null);

  // Ontbrekende schattingen één keer invullen bij openen; daarna de dag opnieuw ophalen.
  const estimated = useRef(false);
  const estimate = useMutation({
    mutationFn: () => request<{ estimated: number }>('POST', '/modules/dagplanning/estimate', { date: day.date }),
    onSuccess: (r) => {
      if (r.estimated > 0) void queryClient.invalidateQueries({ queryKey: dayKey(day.date) });
    }
  });
  useEffect(() => {
    if (!estimated.current && day.missingEstimates > 0) {
      estimated.current = true;
      estimate.mutate();
    }
  }, [day.missingEstimates, estimate]);

  const all = useMemo(() => {
    const m = new Map<string, Item>();
    for (const it of [...day.leftovers, ...day.today, ...day.extra, ...day.planned]) m.set(it.id, it);
    return m;
  }, [day]);

  const minutes = (it: Item) => Math.round((it.agent ? day.settings.agentAttentionMinutes : it.estimate) * day.factor.factor);
  const cap = day.settings.capacity[mode];
  const chosen = [...picked].map((id) => all.get(id)).filter((it): it is Item => !!it && it.status !== 'done');
  const loads = (['work', 'personal'] as const).map((b) => {
    const load = chosen.filter((it) => it.bucket === b).reduce((n, it) => n + minutes(it), 0);
    return { bucket: b, load, cap: cap[b], level: levelOf(load, cap[b]) };
  });
  const agents = chosen.filter((it) => it.agent).length;
  const agentsOver = agents > day.settings.maxParallelAgents;
  const over = agentsOver || loads.some((l) => l.level === 'over');

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = useMutation({
    mutationFn: (ackOver: boolean) =>
      request<{ failed: string[] }>('PUT', '/modules/dagplanning/day', {
        date: day.date,
        planned: [...picked],
        workMode: mode,
        ackOver,
        moves: Object.entries(moves).map(([id, to]) => ({ id, to }))
      }),
    onSuccess: (r) => {
      setAskOver(false);
      setResult({ failed: r.failed.length });
      refreshTasks();
      void queryClient.invalidateQueries({ queryKey: dayKey(day.date) });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'OVERCOMMITTED') setAskOver(true);
    }
  });

  if (result) {
    return (
      <main className="ld-main">
        <div className="ld-empty dp-done" role="status">
          <p>{t('saved')}</p>
          {result.failed > 0 && <p className="ld-meta">{t('failed', { n: result.failed })}</p>}
          <div className="ld-bar">
            <a className="ld-btn" href="#/today">
              {t('toToday')}
            </a>
            <button type="button" className="ld-btn ld-sec" onClick={() => setResult(null)}>
              {t('replan')}
            </button>
          </div>
        </div>
      </main>
    );
  }

  const leftovers = day.leftovers.filter((it) => it.status !== 'done');

  return (
    <main className="ld-main">
      <section className="ld-section" aria-label={t('workday')}>
        <div className="ld-label">{t('workday')}</div>
        <div className="ld-chips">
          {(['normal', 'busy', 'off'] as const).map((m) => (
            <button key={m} type="button" className="ld-chip ld-all" aria-pressed={mode === m} onClick={() => setMode(m)}>
              {t(`mode_${m}`)}
            </button>
          ))}
        </div>
        <Meters loads={loads} i18n={i18n} />
        {(agents > 0 || agentsOver) && (
          <p className={`ld-meta dp-agents ${agentsOver ? 'dp-over' : ''}`}>
            {agentsOver ? `${MARK.over} ` : ''}
            {t(agentsOver ? 'agentsOver' : 'agents', { n: agents, max: day.settings.maxParallelAgents })}
          </p>
        )}
        <p className="ld-meta">
          {t(day.factor.learned ? 'factorLearned' : 'factorStart', { f: day.factor.factor.toLocaleString(i18n.locale), days: day.factor.days })}
          {estimate.isPending ? ` · ${t('estimating')}` : ''}
        </p>
      </section>

      {leftovers.length > 0 && (
        <section className="ld-section">
          <div className="ld-sh">
            <h2>{t('leftoverH')}</h2>
            <button
              type="button"
              className="ld-btn ld-sec ld-sm"
              onClick={() => {
                setMoves((prev) => ({ ...prev, ...Object.fromEntries(leftovers.map((it) => [it.id, 'later' as Move])) }));
                setPicked((prev) => new Set([...prev].filter((id) => !leftovers.some((it) => it.id === id))));
              }}
            >
              {t('allLater')}
            </button>
          </div>
          <p className="ld-meta">{t('leftoverLede')}</p>
          <ul className="ld-list">
            {leftovers.map((it) => (
              <li key={it.id} className="ld-item dp-item">
                <Pick it={it} on={picked.has(it.id)} toggle={toggle} i18n={i18n} />
                <Info it={it} minutes={minutes(it)} i18n={i18n} attention={day.settings.agentAttentionMinutes} />
                <div className="ld-acts">
                  {(['later', 'someday'] as const).map((to) => (
                    <button
                      key={to}
                      type="button"
                      className="ld-chip ld-all"
                      aria-pressed={moves[it.id] === to}
                      onClick={() => {
                        setMoves((prev) => {
                          const next = { ...prev };
                          if (next[it.id] === to) delete next[it.id];
                          else next[it.id] = to;
                          return next;
                        });
                        setPicked((prev) => {
                          const next = new Set(prev);
                          next.delete(it.id);
                          return next;
                        });
                      }}
                    >
                      {t(`move_${to}`)}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="ld-section">
        <div className="ld-sh">
          <h2>{t('todayH')}</h2>
        </div>
        <p className="ld-meta">{t('todayLede')}</p>
        {day.today.length === 0 ? (
          <div className="ld-empty">{t('empty')}</div>
        ) : (
          <ul className="ld-list">
            {day.today.map((it) => (
              <li key={it.id} className="ld-item dp-item">
                <Pick it={it} on={picked.has(it.id)} toggle={toggle} i18n={i18n} />
                <Info it={it} minutes={minutes(it)} i18n={i18n} attention={day.settings.agentAttentionMinutes} />
                <span />
              </li>
            ))}
          </ul>
        )}
      </section>

      {day.extra.length > 0 && (
        <section className="ld-section">
          <div className="ld-sh">
            <h2>{t('extraH')}</h2>
            <button type="button" className="ld-btn ld-sec ld-sm" aria-expanded={showExtra} onClick={() => setShowExtra((v) => !v)}>
              {showExtra ? t('hideExtra') : t('showExtra', { n: day.extra.length })}
            </button>
          </div>
          {showExtra && (
            <>
              <p className="ld-meta">{t('extraLede')}</p>
              <ul className="ld-list">
                {day.extra.map((it) => (
                  <li key={it.id} className="ld-item dp-item">
                    <Pick it={it} on={picked.has(it.id)} toggle={toggle} i18n={i18n} />
                    <Info it={it} minutes={minutes(it)} i18n={i18n} attention={day.settings.agentAttentionMinutes} />
                    <span />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {day.inbox > 0 && (
        <p className="ld-meta">
          {t('inbox', { n: day.inbox })}{' '}
          <a href="#/inbox">{t('openInbox')}</a>
        </p>
      )}

      <div className="dp-foot">
        {askOver ? (
          <div className="ld-confirm" role="alertdialog" aria-label={t('overAsk')}>
            <span>
              {MARK.over} {t('overAsk')}
            </span>
            <button type="button" className="ld-btn" onClick={() => save.mutate(true)} disabled={save.isPending}>
              {t('overYes')}
            </button>
            <button type="button" className="ld-btn ld-sec" onClick={() => setAskOver(false)}>
              {t('overNo')}
            </button>
          </div>
        ) : (
          <button type="button" className="ld-btn" disabled={save.isPending} onClick={() => (over ? setAskOver(true) : save.mutate(false))}>
            {save.isPending ? t('saving') : t('save')}
          </button>
        )}
        {save.isError && !(save.error instanceof ApiError && save.error.code === 'OVERCOMMITTED') && (
          <p className="ld-meta ld-error" role="alert">
            {save.error.message}
          </p>
        )}
      </div>
    </main>
  );
}

function Meters({ loads, i18n }: { loads: { bucket: Bucket; load: number; cap: number; level: Level }[]; i18n: I18n }) {
  const { t, lang } = i18n;
  return (
    <div className="dp-meters">
      {loads.map((l) => (
        <div key={l.bucket} className={`dp-meter dp-${l.level}`}>
          <div className="dp-mhead">
            <span className="ld-label">{t(`bucket_${l.bucket}`)}</span>
            <span className="ld-data">
              {l.cap > 0 ? t('loadLine', { load: fmtMinutes(l.load, lang), cap: fmtMinutes(l.cap, lang) }) : t('noCap')}
            </span>
            <b className="dp-word">
              {MARK[l.level]} {i18n.level(l.level)}
            </b>
          </div>
          <div
            className="dp-track"
            role="meter"
            aria-label={t(`bucket_${l.bucket}`)}
            aria-valuemin={0}
            aria-valuemax={Math.max(l.cap, 1)}
            aria-valuenow={l.load}
            aria-valuetext={`${i18n.level(l.level)}: ${fmtMinutes(l.load, lang)} / ${fmtMinutes(l.cap, lang)}`}
          >
            <i style={{ width: `${Math.min(100, l.cap > 0 ? (l.load / l.cap) * 100 : l.load > 0 ? 100 : 0)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Pick({ it, on, toggle, i18n }: { it: Item; on: boolean; toggle: (id: string) => void; i18n: I18n }) {
  return (
    <input
      type="checkbox"
      className="dp-check"
      checked={on}
      onChange={() => toggle(it.id)}
      aria-label={i18n.t('select', { title: it.title })}
    />
  );
}

function Info({ it, minutes, attention, i18n }: { it: Item; minutes: number; attention: number; i18n: I18n }) {
  const { t, lang } = i18n;
  return (
    <div className="ld-t">
      <span className="ld-title-static">{it.title || '…'}</span>
      <div className="ld-meta">
        <span className="ld-data">±{fmtMinutes(minutes, lang)}</span>
        <span className="dp-src"> · {t(`est_${it.source}`)}</span>
        <span> · {t(`bucket_${it.bucket}`)}</span>
        {it.agent && <span className="dp-agent">{t('agentBadge', { min: fmtMinutes(attention, lang) })}</span>}
        {it.deadline && it.deadline < new Date().toISOString().slice(0, 10) && <span className="ld-flag">{t('late')}</span>}
        {it.split && <span className="ld-flag">{t('split', { n: it.slips })}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- avond

function Evening({ day, i18n, onPlan }: { day: Day; i18n: I18n; onPlan: () => void }) {
  const { t } = i18n;
  const [moves, setMoves] = useState<Record<string, Move>>({});
  const [feedback, setFeedback] = useState<Record<string, 'longer' | 'shorter'>>({});
  const [closed, setClosed] = useState(false);

  const give = useMutation({
    mutationFn: (v: { id: string; verdict: 'longer' | 'shorter' }) => request('POST', '/modules/dagplanning/feedback', v),
    onSuccess: (_r, v) => {
      setFeedback((prev) => ({ ...prev, [v.id]: v.verdict }));
      refreshTasks();
    }
  });
  const close = useMutation({
    mutationFn: () =>
      request('POST', '/modules/dagplanning/close', { date: day.date, moves: Object.entries(moves).map(([id, to]) => ({ id, to })) }),
    onSuccess: () => {
      setClosed(true);
      refreshTasks();
      void queryClient.invalidateQueries({ queryKey: dayKey(day.date) });
    }
  });

  if (!day.plan) {
    return (
      <main className="ld-main">
        <div className="ld-empty">
          <p>{t('noPlan')}</p>
          <button type="button" className="ld-btn ld-sec" onClick={onPlan}>
            {t('planMorning')}
          </button>
        </div>
      </main>
    );
  }
  if (closed || day.plan.closed) {
    return (
      <main className="ld-main">
        <div className="ld-empty dp-done" role="status">
          {t('closed')}
        </div>
      </main>
    );
  }

  const doneSet = new Set(day.plan.done);
  const done = day.planned.filter((it) => doneSet.has(it.id) || it.status === 'done');
  const open = day.planned.filter((it) => !doneSet.has(it.id) && it.status !== 'done');

  return (
    <main className="ld-main">
      <p className="ld-sub" role="status">
        {t('summary', { done: done.length, open: open.length })}
      </p>
      {done.length > 0 && (
        <section className="ld-section">
          <div className="ld-sh">
            <h2>{t('doneH')}</h2>
          </div>
          <ul className="ld-list">
            {done.map((it) => (
              <li key={it.id} className="ld-item dp-item">
                <span className="dp-tick" aria-hidden="true">
                  ✓
                </span>
                <span className="ld-title-static">{it.title}</span>
                <div className="ld-acts">
                  {feedback[it.id] ? (
                    <span className="ld-meta">{t('thanks')}</span>
                  ) : (
                    (['longer', 'shorter'] as const).map((v) => (
                      <button key={v} type="button" className="ld-btn ld-sec ld-sm" disabled={give.isPending} onClick={() => give.mutate({ id: it.id, verdict: v })}>
                        {t(v)}
                      </button>
                    ))
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {open.length > 0 && (
        <section className="ld-section">
          <div className="ld-sh">
            <h2>{t('openH')}</h2>
          </div>
          <p className="ld-meta">{t('leftoverLede')}</p>
          <ul className="ld-list">
            {open.map((it) => (
              <li key={it.id} className="ld-item dp-item">
                <span className="dp-tick" aria-hidden="true">
                  ·
                </span>
                <span className="ld-title-static">{it.title}</span>
                <div className="ld-acts">
                  {(['tomorrow', 'later', 'someday'] as const).map((to) => (
                    <button
                      key={to}
                      type="button"
                      className="ld-chip ld-all"
                      aria-pressed={moves[it.id] === to}
                      onClick={() =>
                        setMoves((prev) => {
                          const next = { ...prev };
                          if (next[it.id] === to) delete next[it.id];
                          else next[it.id] = to;
                          return next;
                        })
                      }
                    >
                      {t(`move_${to}`)}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="dp-foot">
        <button type="button" className="ld-btn" disabled={close.isPending} onClick={() => close.mutate()}>
          {close.isPending ? t('closing') : t('close')}
        </button>
        {close.isError && (
          <p className="ld-meta ld-error" role="alert">
            {close.error.message}
          </p>
        )}
      </div>
    </main>
  );
}
