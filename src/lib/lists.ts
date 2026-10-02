import type { Project, Task, Visibility } from '../../shared/types.js';
import { addDays, daysBetween } from '../../shared/dates.js';
import { deadline, isEvening, isOpen, isToday, projectId, sortOrder, startDate } from '../../shared/taskFields.js';
import { t } from '../i18n/index.js';

export type ListKind = 'inbox' | 'today' | 'upcoming' | 'anytime' | 'someday' | 'waiting' | 'logbook';

export type View =
  | { kind: ListKind }
  | { kind: 'project'; id: string }
  | { kind: 'area'; area: Visibility };

export type Section = { key: string; title?: string; tone?: 'evening' | 'overdue'; tasks: Task[] };

export const AREAS: { readonly id: Visibility; readonly label: string }[] = [
  { id: 'work', get label() { return t('area.work'); } },
  { id: 'personal', get label() { return t('area.personal'); } },
  { id: 'shared', get label() { return t('area.shared'); } }
];

export const bySortOrder = (a: Task, b: Task) => sortOrder(a) - sortOrder(b);

/** Datum waarop een taak in "Gepland" verschijnt, of null. */
export function upcomingDate(t: Task, today: string): string | null {
  if (!isOpen(t) || t.status === 'someday' || isToday(t, today)) return null;
  const start = startDate(t);
  if (start && start > today) return start;
  const due = deadline(t);
  if (due && due > today) return due;
  return null;
}

export function inList(t: Task, kind: ListKind, today: string): boolean {
  if (!isOpen(t)) return kind === 'logbook';
  switch (kind) {
    case 'inbox':
      return t.status === 'inbox' && !startDate(t) && !isToday(t, today);
    case 'today':
      return isToday(t, today);
    case 'upcoming':
      return upcomingDate(t, today) !== null || (t.status === 'scheduled' && !startDate(t) && !deadline(t));
    case 'anytime': {
      if (t.status === 'waiting') return false;
      if (t.status === 'inbox' || t.status === 'someday' || t.status === 'scheduled') return isToday(t, today);
      const start = startDate(t);
      return !start || start <= today;
    }
    case 'someday':
      return t.status === 'someday';
    case 'waiting':
      return t.status === 'waiting';
    case 'logbook':
      return false;
  }
}

export function countFor(tasks: Task[], kind: ListKind, today: string): number {
  return tasks.filter((t) => inList(t, kind, today)).length;
}

export function overdueCount(tasks: Task[], today: string): number {
  return tasks.filter((t) => isOpen(t) && (deadline(t) ?? '9999') < today).length;
}

function groupByProject(tasks: Task[], projects: Project[], projectTitle: (p: Project) => string): Section[] {
  const loose = tasks.filter((t) => !projectId(t));
  const sections: Section[] = loose.length ? [{ key: 'loose', tasks: loose }] : [];
  for (const p of projects) {
    const inProject = tasks.filter((t) => projectId(t) === p.id);
    if (inProject.length) sections.push({ key: p.id, title: projectTitle(p), tasks: inProject });
  }
  const known = new Set(projects.map((p) => p.id));
  const orphans = tasks.filter((t) => projectId(t) && !known.has(projectId(t)!));
  if (orphans.length) {
    if (sections[0]?.key === 'loose') sections[0].tasks.push(...orphans);
    else sections.unshift({ key: 'loose', tasks: orphans });
  }
  return sections;
}

export function buildSections(
  view: View,
  tasks: Task[],
  projects: Project[],
  today: string,
  projectTitle: (p: Project) => string,
  formatDay: (iso: string) => string,
  formatMonth: (iso: string) => string
): Section[] {
  const open = tasks.filter(isOpen).sort(bySortOrder);

  if (view.kind === 'project') {
    return [{ key: 'project', tasks: open.filter((t) => projectId(t) === view.id) }];
  }

  if (view.kind === 'area') {
    const areaProjects = projects.filter((p) => p.visibility === view.area);
    const inArea = open.filter((t) => t.visibility === view.area && !projectId(t) && inList(t, 'anytime', today));
    return inArea.length ? [{ key: 'loose', tasks: inArea }] : areaProjects.length ? [] : [{ key: 'loose', tasks: [] }];
  }

  const kind = view.kind;
  const matching = open.filter((t) => inList(t, kind, today));

  if (kind === 'today') {
    const overdueFirst = (a: Task, b: Task) => {
      const ao = (deadline(a) ?? '9999') < today ? 0 : 1;
      const bo = (deadline(b) ?? '9999') < today ? 0 : 1;
      return ao - bo || bySortOrder(a, b);
    };
    const day = matching.filter((t) => !isEvening(t)).sort(overdueFirst);
    const evening = matching.filter(isEvening).sort(overdueFirst);
    return [
      { key: 'today', tasks: day },
      ...(evening.length ? [{ key: 'evening', title: t('section.thisEvening'), tone: 'evening' as const, tasks: evening }] : [])
    ];
  }

  if (kind === 'upcoming') {
    const groups = new Map<string, Section>();
    const dated = matching
      .map((task) => ({ task, d: upcomingDate(task, today) }))
      .sort((a, b) => (a.d ?? '9999').localeCompare(b.d ?? '9999') || bySortOrder(a.task, b.task));
    // Things toont de komende 7 dagen altijd, ook als ze leeg zijn.
    for (let i = 1; i <= 7; i++) {
      const d = addDays(today, i);
      groups.set(d, { key: d, title: formatDay(d), tasks: [] });
    }
    for (const { task, d } of dated) {
      if (!d) {
        const key = 'undated';
        if (!groups.has(key)) groups.set(key, { key, title: t('section.scheduledUndated'), tasks: [] });
        groups.get(key)!.tasks.push(task);
        continue;
      }
      const key = daysBetween(today, d) <= 7 ? d : d.slice(0, 7);
      if (!groups.has(key)) groups.set(key, { key, title: key.length === 7 ? formatMonth(d) : formatDay(d), tasks: [] });
      groups.get(key)!.tasks.push(task);
    }
    const sections = [...groups.values()];
    const undated = sections.findIndex((s) => s.key === 'undated');
    if (undated >= 0) sections.push(...sections.splice(undated, 1));
    return sections;
  }

  if (kind === 'anytime' || kind === 'someday') {
    return groupByProject(matching, projects, projectTitle);
  }

  return [{ key: kind, tasks: matching }];
}

/** Sorteerwaarde tussen twee buren, voor drag & drop. */
export function orderBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 0;
  if (before === null) return after! - 1;
  if (after === null) return before + 1;
  return (before + after) / 2;
}
