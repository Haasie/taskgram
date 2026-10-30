import { useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, Pencil, Radar } from 'lucide-react';
import type { Project, Task, Visibility } from '../../shared/types.js';
import {
  RADAR_STATUSES,
  RADAR_TAG,
  RAG_VALUES,
  countsByProject,
  daysLeft,
  emptyCounts,
  radarMeta,
  radarProjects,
  radarSummary,
  rankRadar,
  type RadarPatch,
  type Rag
} from '../../shared/radar.js';
import { formatDeadline, formatLong } from '../../shared/dates.js';
import { updateProject, useProjects, useTasks } from '../lib/queries';
import { useSyncStatus } from '../lib/sync';
import { t, useLang } from '../i18n/index.js';
import { projectTitle } from './UiContext';

type Status = (typeof RADAR_STATUSES)[number];

const STATUS_BAR: Record<Status, string> = {
  active: 'bg-sky-500',
  next: 'bg-teal-500',
  waiting: 'bg-violet-500',
  scheduled: 'bg-rose-400',
  inbox: 'bg-zinc-400',
  someday: 'bg-zinc-200 dark:bg-zinc-700'
};

const RAG_STAMP: Record<Rag, string> = {
  rood: 'border-rose-500 text-rose-600 dark:text-rose-400',
  oranje: 'border-amber-500 text-amber-700 dark:text-amber-300',
  groen: 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
};

type Props = {
  area: Visibility;
  tasks: Task[];
  projects: Project[];
  today: string;
  onOpenProject: (id: string) => void;
};

/** Ingang voor de modules Werkradar en Privéradar: haalt taken en projecten zelf op. */
export function RadarModule({ area, today }: { area: Visibility; today: string }) {
  const tasks = useTasks().data;
  const projects = useProjects().data;
  return (
    <RadarView
      area={area}
      tasks={tasks ?? []}
      projects={projects ?? []}
      today={today}
      onOpenProject={(id) => (window.location.hash = `#/project/${id}`)}
    />
  );
}

export function RadarView({ area, tasks, projects, today, onOpenProject }: Props) {
  useLang();
  const tag = RADAR_TAG[area] ?? '';
  const ranked = useMemo(() => rankRadar(radarProjects(projects, area)), [projects, area]);
  const counts = useMemo(() => countsByProject(tasks), [tasks]);
  const summary = useMemo(() => radarSummary(tasks, projects, area, today), [tasks, projects, area, today]);
  const title = area === 'work' ? t('radar.title.work') : t('radar.title.personal');

  const kpis: { key: string; label: string; value: number; alert?: boolean }[] = [
    { key: 'active', label: t('radar.kpi.active'), value: summary.active },
    { key: 'next', label: t('radar.kpi.next'), value: summary.next },
    { key: 'waiting', label: t('radar.kpi.waiting'), value: summary.waiting },
    { key: 'inbox', label: t('radar.kpi.inbox'), value: summary.inbox },
    { key: 'stale', label: t('radar.kpi.stale'), value: summary.stale, alert: summary.stale > 0 },
    { key: 'unassigned', label: t('radar.kpi.unassigned'), value: summary.unassigned, alert: summary.unassigned > 0 }
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-32 pt-6 sm:px-10 md:pt-14" data-testid="radar-view">
      <div className="mb-2 flex items-center gap-3">
        <Radar size={26} className={area === 'work' ? 'text-sky-600' : 'text-emerald-600'} />
        <h2 className="flex-1 text-[26px] font-bold tracking-tight">{title}</h2>
      </div>
      <p className="mb-6 text-sm text-zinc-500">{t('radar.lede', { tag })}</p>

      <div className="mb-8 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.key} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{k.label}</div>
            <div className={`text-2xl font-semibold tabular-nums ${k.alert ? 'text-rose-600 dark:text-rose-400' : ''}`}>{k.value}</div>
          </div>
        ))}
      </div>

      {ranked.length === 0 ? (
        <p className="text-sm text-zinc-400">{t('radar.empty', { tag })}</p>
      ) : (
        <>
          <Legend />
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {ranked.map((p) => (
              <RadarCard key={p.id} project={p} counts={counts.get(p.id) ?? emptyCounts()} today={today} onOpen={() => onOpenProject(p.id)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function legendLabel(s: Status): string {
  switch (s) {
    case 'active': return t('radar.kpi.active');
    case 'next': return t('radar.kpi.next');
    case 'waiting': return t('radar.kpi.waiting');
    case 'scheduled': return t('list.upcoming');
    case 'inbox': return t('list.inbox');
    case 'someday': return t('list.someday');
  }
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
      {RADAR_STATUSES.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <i className={`inline-block size-2.5 ${STATUS_BAR[s]}`} />
          {legendLabel(s)}
        </span>
      ))}
    </div>
  );
}

function Row({ label, children, tone }: { label: string; children: ReactNode; tone?: 'alert' }) {
  return (
    <>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className={`min-w-0 ${tone === 'alert' ? 'font-semibold text-rose-600 dark:text-rose-400' : ''}`}>{children}</dd>
    </>
  );
}

function RadarCard({ project, counts, today, onOpen }: { project: Project; counts: ReturnType<typeof emptyCounts>; today: string; onOpen: () => void }) {
  const m = radarMeta(project);
  const [editing, setEditing] = useState(false);
  const left = daysLeft(m.deadline, today);
  // Datum plus relatief: "vr 31 okt · nog 3 dagen".
  const due = m.deadline && `${formatLong(m.deadline)} · ${formatDeadline(m.deadline, today)}`;
  const parts = RADAR_STATUSES.filter((s) => counts[s] > 0).map((s) => t(`radar.count.${s}` as const, { n: counts[s] }));

  return (
    <article className="flex min-w-0 flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900" data-testid="radar-card">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs tracking-wider text-zinc-500">
          {m.code}
          {m.spoor ? ` · ${m.spoor.toUpperCase()}` : ''}
        </span>
        {m.rag ? (
          <span className={`border-[3px] border-double px-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider ${RAG_STAMP[m.rag]}`}>{t(`radar.rag.${m.rag}` as const)}</span>
        ) : null}
      </div>
      <button type="button" onClick={onOpen} className="text-left text-[17px] font-semibold leading-snug hover:text-sky-600">
        {m.naam ?? projectTitle(project)}
      </button>

      {editing ? (
        <RadarEditor project={project} onClose={() => setEditing(false)} />
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {m.fase && <Row label={t('radar.field.fase')}>{m.fase}</Row>}
          {m.volgende_stap && <Row label={t('radar.field.volgende_stap')}>{m.volgende_stap}</Row>}
          {m.extern && <Row label={t('radar.field.extern')}>{m.extern}</Row>}
          {due && (
            <Row label={t('radar.field.deadline')} tone={left !== null && left <= 14 ? 'alert' : undefined}>
              {due}
            </Row>
          )}
          {m.risico && <Row label={t('radar.field.risico')}>{m.risico}</Row>}
        </dl>
      )}

      <div className="mt-auto flex h-2 overflow-hidden rounded-sm ring-1 ring-inset ring-zinc-200 dark:ring-zinc-800" aria-hidden>
        {RADAR_STATUSES.map((s) =>
          counts[s] ? <span key={s} className={STATUS_BAR[s]} style={{ width: `${(counts[s] / counts.total) * 100}%` }} /> : null
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs tabular-nums text-zinc-500">{parts.length ? parts.join(' · ') : t('radar.noTasks')}</p>
        <div className="flex shrink-0 gap-1">
          {!editing && (
            <button type="button" onClick={() => setEditing(true)} className="icon-btn text-zinc-400" title={t('radar.edit')} aria-label={t('radar.edit')}>
              <Pencil size={15} />
            </button>
          )}
          <button type="button" onClick={onOpen} className="icon-btn text-zinc-400" title={t('radar.openProject')} aria-label={t('radar.openProject')}>
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}

function RadarEditor({ project, onClose }: { project: Project; onClose: () => void }) {
  const m = radarMeta(project);
  const { online } = useSyncStatus();
  const [form, setForm] = useState({
    fase: m.fase ?? '',
    rag: m.rag ?? '',
    volgende_stap: m.volgende_stap ?? '',
    extern: m.extern ?? '',
    deadline: m.deadline ?? '',
    risico: m.risico ?? ''
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = () => {
    const clean = (v: string) => (v.trim() ? v.trim() : null);
    const patch: RadarPatch = {
      fase: clean(form.fase),
      rag: (form.rag || null) as Rag | null,
      volgende_stap: clean(form.volgende_stap),
      extern: clean(form.extern),
      deadline: clean(form.deadline),
      risico: clean(form.risico)
    };
    // Alleen gewijzigde velden versturen.
    const changed = Object.fromEntries(Object.entries(patch).filter(([k, v]) => (m as Record<string, unknown>)[k] !== v)) as RadarPatch;
    if (Object.keys(changed).length) void updateProject(project.id, { metadata: changed });
    onClose();
  };

  const field = 'input w-full text-sm';
  return (
    <form
      className="grid gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="grid gap-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{t('radar.field.rag')}</span>
        <select className={field} value={form.rag} onChange={set('rag')}>
          <option value="">{t('radar.rag.none')}</option>
          {RAG_VALUES.map((r) => (
            <option key={r} value={r}>
              {t(`radar.rag.${r}` as const)}
            </option>
          ))}
        </select>
      </label>
      {(['fase', 'volgende_stap', 'extern', 'risico'] as const).map((k) => (
        <label key={k} className="grid gap-0.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{t(`radar.field.${k}` as const)}</span>
          <input className={field} value={form[k]} onChange={set(k)} maxLength={k === 'fase' ? 200 : 500} />
        </label>
      ))}
      <label className="grid gap-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{t('radar.field.deadline')}</span>
        <input type="date" className={field} value={form.deadline} onChange={set('deadline')} />
      </label>
      <div className="mt-1 flex justify-end gap-2">
        <button type="button" className="btn" onClick={onClose}>
          {t('radar.cancel')}
        </button>
        <button type="submit" className="btn-primary" disabled={!online} title={online ? undefined : t('toast.offline')}>
          {t('radar.save')}
        </button>
      </div>
    </form>
  );
}
