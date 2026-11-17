import '../_design';
import './dagplanning.css';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, request } from '../../src/lib/api';
import { completeTask, outboxEngine, queryClient, reopenTask, useTasks } from '../../src/lib/queries';
import { todayISO } from '../../shared/dates';
import type { Task } from '../../shared/types';
import type { ModuleViewProps } from '../types';
import { useT } from './i18n';
import { fmtMinutes, levelOf, withKept, type Bucket, type Level, type WorkMode } from './logic';

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
  agenda: {
    configured: boolean;
    failed: number;
    items: { title: string; calendar: string; allDay: boolean; start: string | null; end: string | null }[];
    busy: Record<Bucket, number>;
  };
};

type I18n = ReturnType<typeof useT>;
type Section = 'leftovers' | 'today' | 'extra';

/** Afronden en heropenen via de mutaties van de core (optimistisch, met outbox en conflictafhandeling). */
function useCompletion(date: string, i18n: I18n) {
  const tasks = useTasks().data;
  const cache = useMemo(() => new Map((tasks ?? []).map((t) => [t.id, t])), [tasks]);
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);

  // Zodra de outbox leeg is (ook na een conflict of fout) de dag en takenlijsten opnieuw ophalen.
  // Eerst de dag, dan de taken: anders valt een afgeronde rij heel even terug naar open.
  useEffect(
    () =>
      outboxEngine.subscribe(() => {
        if (!dirty.current || outboxEngine.pending().length > 0) return;
        dirty.current = false;
        void queryClient.invalidateQueries({ queryKey: dayKey(date) }).then(refreshTasks);
      }),
    [date]
  );

  // Geen ruwe fouttekst in beeld: die kan adressen of interne details bevatten.
  const fail = () => setError(i18n.t('completeFailed'));

  // De cache van de core wint (die kent de optimistische stand); daarna wat de server in de dag meegaf.
  const isDone = (it: Item, fallback = false) => {
    const c = cache.get(it.id);
    return c ? c.status === 'done' : it.status === 'done' || fallback;
  };

  const complete = (it: Item) => {
    const task = cache.get(it.id);
    if (!task) return fail();
    setError(null);
    dirty.current = true;
    completeTask(task).catch(fail);
  };

  const reopen = async (it: Item) => {
    setError(null);
    try {
      // Afgeronde taken staan niet in de takenlijst van de core; haal hem op zodat de core hem kan heropenen.
      if (!cache.has(it.id)) {
        const fetched: Task = await api.getTask(it.id);
        queryClient.setQueryData<Task[]>(['tasks'], (old) => [fetched, ...(old ?? []).filter((t) => t.id !== fetched.id)]);
      }
      dirty.current = true;
      await reopenTask(it.id);
    } catch {
      fail();
    }
  };

  return { isDone, complete, reopen, error };
}

const dayKey = (date: string) => ['module', 'dagplanning', 'day', date] as const;
const refreshTasks = () => void queryClient.invalidateQueries({ queryKey: ['tasks'] });

export default function DagplanningView({ today }: ModuleViewProps) {
  const i18n = useT();
  const { t } = i18n;
  const q = useQuery({ queryKey: dayKey(today), queryFn: () => request<Day>('GET', `/modules/dagplanning/day?date=${today}`) });
  const data = q.data;
  const [tab, setTab] = useState<'morning' | 'evening' | null>(null);
  // Standaard: avond zodra er een plan is en het na vieren is; anders ochtend.
  // Eén keer bepaald bij het openen: wie na vieren zijn plan vastlegt, blijft in de ochtend en ziet de bevestiging.
  const autoTab = useRef<'morning' | 'evening' | null>(null);
  if (data && autoTab.current === null) {
    autoTab.current = data.plan && !data.plan.closed && new Date().getHours() >= 16 ? 'evening' : 'morning';
  }
  const active = tab ?? autoTab.current ?? 'morning';

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
  const done = useCompletion(day.date, i18n);
  // Afgevinkte rijen blijven zichtbaar, ook als de server ze niet meer als open taak teruggeeft.
  const [kept, setKept] = useState<Map<string, { item: Item; section: Section }>>(() => new Map());

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
  const chosen = [...picked].map((id) => all.get(id)).filter((it): it is Item => !!it && !done.isDone(it));
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

  const present = new Set([...day.leftovers, ...day.today, ...day.extra].map((it) => it.id));
  const keptIn = (section: Section) => new Map([...kept].filter(([, v]) => v.section === section).map(([id, v]) => [id, v.item]));
  // Na opnieuw openen: wat vandaag al af was en in het plan staat, staat niet meer in de lijsten van de server.
  const plannedDone = new Map(day.planned.filter((it) => it.status === 'done').map((it) => [it.id, it]));
  const rows: Record<Section, Item[]> = {
    leftovers: withKept(day.leftovers, keptIn('leftovers'), present),
    today: withKept(withKept(day.today, keptIn('today'), present), plannedDone, new Set([...present, ...kept.keys()])),
    extra: withKept(day.extra, keptIn('extra'), present)
  };
  const leftovers = rows.leftovers.filter((it) => !done.isDone(it));
  const finish = (it: Item, section: Section) => {
    setKept((prev) => new Map(prev).set(it.id, { item: { ...it, status: 'done' }, section }));
    done.complete(it);
  };
  const rowOf = (it: Item, section: Section, extra?: React.ReactNode) => (
    <Row
      key={it.id}
      it={it}
      done={done.isDone(it)}
      picked={picked.has(it.id)}
      toggle={toggle}
      minutes={minutes(it)}
      attention={day.settings.agentAttentionMinutes}
      onComplete={() => finish(it, section)}
      onReopen={() => void done.reopen(it)}
      i18n={i18n}
    >
      {extra}
    </Row>
  );

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

      <AgendaBlock day={day} i18n={i18n} />

      {rows.leftovers.length > 0 && (
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
            {rows.leftovers.map((it) =>
              rowOf(
                it,
                'leftovers',
                done.isDone(it) ? null : (
                  <>
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
                  </>
                )
              )
            )}
          </ul>
        </section>
      )}

      <section className="ld-section">
        <div className="ld-sh">
          <h2>{t('todayH')}</h2>
        </div>
        <p className="ld-meta">{t('todayLede')}</p>
        {rows.today.length === 0 ? (
          <div className="ld-empty">{t('empty')}</div>
        ) : (
          <ul className="ld-list">{rows.today.map((it) => rowOf(it, 'today'))}</ul>
        )}
      </section>

      {rows.extra.length > 0 && (
        <section className="ld-section">
          <div className="ld-sh">
            <h2>{t('extraH')}</h2>
            <button type="button" className="ld-btn ld-sec ld-sm" aria-expanded={showExtra} onClick={() => setShowExtra((v) => !v)}>
              {showExtra ? t('hideExtra') : t('showExtra', { n: rows.extra.length })}
            </button>
          </div>
          {showExtra && (
            <>
              <p className="ld-meta">{t('extraLede')}</p>
              <ul className="ld-list">{rows.extra.map((it) => rowOf(it, 'extra'))}</ul>
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
        {done.error && (
          <p className="ld-meta ld-error" role="alert">
            {done.error}
          </p>
        )}
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

function AgendaBlock({ day, i18n }: { day: Day; i18n: I18n }) {
  const { t, lang } = i18n;
  const a = day.agenda;
  if (!a.configured) return null;
  const busy = (['work', 'personal'] as const).filter((b) => a.busy[b] > 0);
  return (
    <section className="ld-section" aria-label={t('agendaH')}>
      <div className="ld-sh">
        <h2>{t('agendaH')}</h2>
      </div>
      {a.failed > 0 && a.items.length === 0 ? (
        <p className="ld-meta" role="status">
          {MARK.tight} {t('agendaDown')}
        </p>
      ) : a.items.length === 0 ? (
        <p className="ld-meta">{t('agendaEmpty')}</p>
      ) : (
        <ul className="ld-list">
          {a.items.map((e, i) => (
            <li key={i} className="ld-item dp-item dp-cal">
              <span className="ld-data dp-time">{e.allDay ? t('allDay') : `${e.start}–${e.end}`}</span>
              <span className="ld-title-static">{e.title || '…'}</span>
              <span className="ld-meta">{e.calendar}</span>
            </li>
          ))}
        </ul>
      )}
      {busy.length > 0 && (
        <p className="ld-meta">
          {t('agendaBusy', { parts: busy.map((b) => `${fmtMinutes(a.busy[b], lang)} ${t(`bucket_${b}`)}`).join(' · ') })}
        </p>
      )}
      {a.failed > 0 && a.items.length > 0 && <p className="ld-meta">{t('agendaPartly', { n: a.failed })}</p>}
    </section>
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

/** Afronden en ongedaan maken: een eigen knop met woord en raakvlak van minstens 44 px, los van de selectie. */
function CompleteButton({ it, done, onComplete, onReopen, i18n }: { it: Item; done: boolean; onComplete: () => void; onReopen: () => void; i18n: I18n }) {
  const { t } = i18n;
  return done ? (
    <button type="button" className="ld-btn ld-sec dp-act dp-reopen" aria-label={t('reopen', { title: it.title })} onClick={onReopen}>
      <span aria-hidden="true">↺ </span>
      {t('reopenWord')}
    </button>
  ) : (
    <button type="button" className="ld-btn dp-act dp-complete" aria-label={t('complete', { title: it.title })} onClick={onComplete}>
      <span aria-hidden="true">✓ </span>
      {t('completeWord')}
    </button>
  );
}

/** Eén taakrij in het ochtendscherm: selecteren (checkbox) en afronden (knop) zijn bewust verschillende bedieningen. */
function Row({
  it, done, picked, toggle, minutes, attention, onComplete, onReopen, i18n, children
}: {
  it: Item; done: boolean; picked: boolean; toggle: (id: string) => void; minutes: number; attention: number;
  onComplete: () => void; onReopen: () => void; i18n: I18n; children?: React.ReactNode;
}) {
  return (
    <li className={`ld-item dp-item ${done ? 'dp-isdone' : ''}`}>
      {done ? (
        <span className="dp-tick" aria-hidden="true">
          ✓
        </span>
      ) : (
        <Pick it={it} on={picked} toggle={toggle} i18n={i18n} />
      )}
      <Info it={it} done={done} minutes={minutes} i18n={i18n} attention={attention} />
      <div className="ld-acts">
        {children}
        <CompleteButton it={it} done={done} onComplete={onComplete} onReopen={onReopen} i18n={i18n} />
      </div>
    </li>
  );
}

function Info({ it, done = false, minutes, attention, i18n }: { it: Item; done?: boolean; minutes: number; attention: number; i18n: I18n }) {
  const { t, lang } = i18n;
  return (
    <div className="ld-t">
      <span className={`ld-title-static ${done ? 'dp-struck' : ''}`}>{it.title || '…'}</span>
      <div className="ld-meta">
        {done && <span className="dp-donetag">✓ {t('doneTag')}</span>}
        <span className="ld-data">±{fmtMinutes(minutes, lang)}</span>
        <span className="dp-src"> · {t(`est_${it.source}`)}</span>
        <span> · {t(`bucket_${it.bucket}`)}</span>
        {it.agent && <span className="dp-agent">{t('agentBadge', { min: fmtMinutes(attention, lang) })}</span>}
        {!done && it.deadline && it.deadline < todayISO() && <span className="ld-flag">{t('late')}</span>}
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
  const completion = useCompletion(day.date, i18n);

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
  const isDone = (it: Item) => completion.isDone(it, doneSet.has(it.id));
  const done = day.planned.filter(isDone);
  const open = day.planned.filter((it) => !isDone(it));

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
                <span className="ld-title-static dp-struck">
                  {it.title}
                  <span className="dp-donetag"> ✓ {t('doneTag')}</span>
                </span>
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
                  <CompleteButton it={it} done onComplete={() => completion.complete(it)} onReopen={() => void completion.reopen(it)} i18n={i18n} />
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
                  <CompleteButton it={it} done={false} onComplete={() => completion.complete(it)} onReopen={() => void completion.reopen(it)} i18n={i18n} />
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
        {completion.error && (
          <p className="ld-meta ld-error" role="alert">
            {completion.error}
          </p>
        )}
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
