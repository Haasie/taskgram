import { useDroppable } from '@dnd-kit/core';
import { Plus, Search, Box, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Project, Task, Visibility } from '../../shared/types.js';
import { AREAS, countFor, overdueCount, type ListKind } from '../lib/lists';
import { isOpen, projectId } from '../../shared/taskFields.js';
import type { Route } from '../lib/useHashView';
import { LIST_META, ProgressRing } from './icons';
import { projectTitle } from './UiContext';
import { useSyncStatus } from '../lib/sync';
import { SyncIndicator } from './SyncIndicator';
import { t, useLang } from '../i18n/index.js';

type Props = {
  route: Route;
  tasks: Task[];
  projects: Project[];
  today: string;
  onNavigate: (route: Route) => void;
  onNewProject: (area: Visibility) => void;
  onSearch: () => void;
  onOpenConflicts?: () => void;
  onOpenSettings?: () => void;
  user?: string;
};

function Item({ id, active, onClick, icon, label, count, alert }: { id: string; active: boolean; onClick: () => void; icon: ReactNode; label: string; count?: number; alert?: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop:${id}` });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[15px] md:py-1 md:text-sm ${
        isOver ? 'bg-sky-500 text-white' : active ? 'bg-zinc-200/80 dark:bg-zinc-700/60' : 'hover:bg-zinc-200/50 dark:hover:bg-zinc-800'
      }`}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {!!alert && <span className="rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold text-white">{alert}</span>}
      {!!count && <span className="text-xs text-zinc-400">{count}</span>}
    </button>
  );
}

const MAIN: ListKind[] = ['inbox', 'today', 'upcoming', 'anytime', 'someday'];
const EXTRA: ListKind[] = ['waiting', 'logbook'];

export function Sidebar({ route, tasks, projects, today, onNavigate, onNewProject, onSearch, onOpenConflicts, onOpenSettings, user }: Props) {
  useLang();
  const { online } = useSyncStatus();

  const listItem = (kind: ListKind) => {
    const { label, Icon, color } = LIST_META[kind];
    const count = kind === 'logbook' || kind === 'upcoming' ? undefined : countFor(tasks, kind, today);
    return (
      <Item
        key={kind}
        id={kind}
        active={route.kind === kind}
        onClick={() => onNavigate({ kind })}
        icon={<Icon size={17} className={`${color} ${kind === 'today' ? 'fill-amber-400' : ''}`} />}
        label={label}
        count={count}
        alert={kind === 'today' ? overdueCount(tasks, today) : undefined}
      />
    );
  };

  return (
    <nav className="flex h-full flex-col gap-4 overflow-y-auto px-3 pb-24 pt-[max(1rem,env(safe-area-inset-top))] md:pb-4">
      <button type="button" onClick={onSearch} className="flex items-center gap-2 rounded-lg bg-zinc-200/60 px-3 py-2 text-sm text-zinc-500 dark:bg-zinc-800">
        <Search size={15} /> {t('sidebar.quickFind')} <kbd className="ml-auto hidden text-xs md:inline">/</kbd>
      </button>
      <div className="space-y-0.5">{MAIN.map(listItem)}</div>
      <div className="space-y-0.5">{EXTRA.map(listItem)}</div>

      {AREAS.map((area) => {
        const areaProjects = projects.filter((p) => p.visibility === area.id && p.status !== 'done');
        const hasTasks = tasks.some((t) => t.visibility === area.id && isOpen(t));
        if (!areaProjects.length && !hasTasks) return null;
        return (
          <div key={area.id} className="space-y-0.5">
            <div className="group flex items-center">
              <div className="flex-1">
                <Item
                  id={`area:${area.id}`}
                  active={route.kind === 'area' && route.area === area.id}
                  onClick={() => onNavigate({ kind: 'area', area: area.id })}
                  icon={<Box size={16} className="text-zinc-400" />}
                  label={area.label}
                />
              </div>
              <button
                type="button"
                disabled={!online}
                title={online ? t('sidebar.newProject') : t('toast.offline')}
                onClick={() => online && onNewProject(area.id)}
                className="icon-btn opacity-60 disabled:opacity-20 md:opacity-0 md:group-hover:opacity-60"
              >
                <Plus size={15} />
              </button>
            </div>
            {areaProjects.map((p) => {
              const open = tasks.filter((t) => projectId(t) === p.id && isOpen(t)).length;
              return (
                <Item
                  key={p.id}
                  id={`project:${p.id}`}
                  active={route.kind === 'project' && route.id === p.id}
                  onClick={() => onNavigate({ kind: 'project', id: p.id })}
                  icon={<ProgressRing done={0} total={open} />}
                  label={projectTitle(p)}
                  count={open || undefined}
                />
              );
            })}
          </div>
        );
      })}
      <div className="mt-auto flex flex-col gap-2 px-2.5">
        <SyncIndicator onOpenConflicts={onOpenConflicts} />
        <div className="flex items-center justify-between">
          {user ? <p className="text-xs text-zinc-400">{t('sidebar.loggedInAs', { user })}</p> : <div />}
          <button
            type="button"
            onClick={onOpenSettings}
            className="icon-btn text-zinc-400 hover:text-zinc-600 max-md:hidden dark:hover:text-zinc-200"
            title={t('sidebar.settings')}
            aria-label={t('sidebar.settings')}
          >
            <Settings size={16} />
          </button>
        </div>
      </div>
    </nav>
  );
}
