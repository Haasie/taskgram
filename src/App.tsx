import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useQuery } from '@tanstack/react-query';
import { Box, CheckCircle2, ChevronLeft, Keyboard, MoreHorizontal, Plus, Archive as ArchiveIcon, Settings } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project, Task, Visibility } from '../shared/types.js';
import { api } from './lib/api';
import { formatLong, formatMonth, todayISO } from '../shared/dates.js';
import { isOpen, projectId, sortOrder } from '../shared/taskFields.js';
import { dropPatch } from './lib/dnd';
import { AREAS, buildSections, orderBetween, type ListKind, type Section, type View } from './lib/lists';
import { completeTask, createProject, onTaskIdRewritten, reopenTask, updateProject, updateTask, useProjects, useTasks, deleteTask } from './lib/queries';
import { splitContent } from './lib/task';
import { showToast } from './lib/toast';
import { useSyncStatus } from './lib/sync';
import { useHashRoute, useMediaQuery, type Route } from './lib/useHashView';
import { whenPatch, type WhenChoice } from './lib/when';
import { LIST_META } from './components/icons';
import { ListView } from './components/ListView';
import { Logbook } from './components/Logbook';
import { Modal } from './components/Modal';
import { QuickEntry, type QuickEntryDefaults } from './components/QuickEntry';
import { QuickFind } from './components/QuickFind';
import { Sidebar } from './components/Sidebar';
import { SyncIndicator } from './components/SyncIndicator';
import { ConflictDialog } from './components/ConflictDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { TaskRow } from './components/TaskRow';
import { Toasts } from './components/Toasts';
import { isListedProject, projectTitle, UiContext, type Ui } from './components/UiContext';
import { WhenPicker, type PickerState } from './components/WhenPicker';
import { LoginScreen } from './components/LoginScreen';
import { t, useLang } from './i18n/index.js';

const LIST_KEYS: ListKind[] = ['inbox', 'today', 'upcoming', 'anytime', 'someday', 'waiting', 'logbook'];

function useToday() {
  const [today, setToday] = useState(todayISO);
  useEffect(() => {
    const tick = () => setToday(todayISO());
    const id = setInterval(tick, 60_000);
    window.addEventListener('focus', tick);
    return () => (clearInterval(id), window.removeEventListener('focus', tick));
  }, []);
  return today;
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

// Sidebar-doelen gaan voor; anders de dichtstbijzijnde taak.
const collision: CollisionDetection = (args) => {
  const pointer = pointerWithin(args).filter((c) => String(c.id).startsWith('drop:'));
  return pointer.length ? pointer : closestCenter(args);
};

export function App() {
  useLang();
  const tasksQuery = useTasks();
  const projectsQuery = useProjects();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: Infinity });
  const authQuery = useQuery({
    queryKey: ['auth'],
    queryFn: api.authConfig,
    retry: (failureCount, error: any) => {
      if (error?.status >= 400 && error?.status < 500) return false;
      return failureCount < 3;
    },
    staleTime: 60_000
  });

  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const allProjects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const projects = useMemo(() => {
    const used = new Set((tasksQuery.data ?? []).map(projectId).filter((id): id is string => !!id));
    return allProjects.filter((p) => isListedProject(p, used));
  }, [allProjects, tasksQuery.data]);
  const today = useToday();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [route, navigate] = useHashRoute();

  const syncStatus = useSyncStatus();
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerState>(null);
  const [entry, setEntry] = useState<{ open: boolean; defaults: QuickEntryDefaults }>({ open: false, defaults: {} });
  const [findOpen, setFindOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dragging, setDragging] = useState<Task | null>(null);

  useEffect(() => {
    return onTaskIdRewritten((oldId, newId) => {
      setSelectedId((curr) => (curr === oldId ? newId : curr));
      setExpandedId((curr) => (curr === oldId ? newId : curr));
    });
  }, []);

  useEffect(() => {
    if (isDesktop && route.kind === 'home') navigate({ kind: 'today' });
  }, [isDesktop, route.kind, navigate]);

  const view: View | null = route.kind === 'home' ? null : route;
  const viewKey = view ? JSON.stringify(view) : 'home';
  useEffect(() => {
    setSelectedId(null);
    setExpandedId(null);
    window.scrollTo(0, 0);
  }, [viewKey]);

  const projectsById = useMemo(() => new Map(allProjects.map((p) => [p.id, p])), [allProjects]);
  const allTags = useMemo(() => [...new Set(tasks.flatMap((t) => t.tags))].sort(), [tasks]);

  const sections: Section[] = useMemo(
    () => (view && view.kind !== 'logbook' ? buildSections(view, tasks, projects, today, projectTitle, formatLong, (d) => formatMonth(d, today)) : []),
    [view, tasks, projects, today]
  );
  const ordered = useMemo(() => sections.flatMap((s) => s.tasks), [sections]);

  const complete = useCallback((task: Task) => {
    void completeTask(task);
    showToast(t('toast.taskCompleted'), { label: t('toast.undo'), run: () => void reopenTask(task.id) });
  }, []);

  const applyWhen = useCallback((task: Task, choice: WhenChoice) => void updateTask(task, whenPatch(choice, todayISO())), []);

  const ui: Ui = useMemo(
    () => ({
      today,
      projects,
      projectsById,
      allTags,
      selectedId,
      expandedId,
      select: setSelectedId,
      expand: (id) => {
        setExpandedId(id);
        if (id) setSelectedId(id);
      },
      openPicker: setPicker,
      complete
    }),
    [today, projects, projectsById, allTags, selectedId, expandedId, complete]
  );

  const entryDefaults = useCallback((): QuickEntryDefaults => {
    if (!view) return {};
    switch (view.kind) {
      case 'today':
        return { when: { kind: 'today' } };
      case 'anytime':
        return { when: { kind: 'anytime' } };
      case 'someday':
        return { when: { kind: 'someday' } };
      case 'waiting':
        return { when: { kind: 'waiting' } };
      case 'project':
        return { when: { kind: 'anytime' }, projectId: view.id };
      case 'area':
        return { when: { kind: 'anytime' }, visibility: view.area };
      default:
        return {};
    }
  }, [view]);
  const openEntry = useCallback(() => setEntry({ open: true, defaults: entryDefaults() }), [entryDefaults]);

  const openTask = useCallback(
    (task: Task) => {
      const home: ListKind = task.status === 'someday' ? 'someday' : task.status === 'inbox' ? 'inbox' : 'anytime';
      const pid = projectId(task);
      navigate(pid && projectsById.has(pid) ? { kind: 'project', id: pid } : { kind: home });
      setTimeout(() => {
        setExpandedId(task.id);
        setSelectedId(task.id);
        document.querySelector(`[data-task-id="${task.id}"]`)?.scrollIntoView({ block: 'center' });
      }, 50);
    },
    [navigate, projectsById]
  );

  const newProject = useCallback(
    async (area: Visibility) => {
      if (!syncStatus.online) {
        showToast(t('toast.offline'));
        return;
      }
      const name = window.prompt(t('app.newProjectPrompt'));
      if (!name?.trim()) return;
      const project = await createProject(name.trim(), area);
      if (project) navigate({ kind: 'project', id: project.id });
    },
    [navigate, syncStatus.online]
  );

  // ---------- Toetsenbord ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setFindOpen(true);
        return;
      }
      if (isTyping(e.target) || picker || entry.open || findOpen || helpOpen) {
        if (e.key === 'Escape' && isTyping(e.target) && expandedId) {
          (e.target as HTMLElement).blur();
          setExpandedId(null);
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const selected = ordered.find((t) => t.id === selectedId) ?? null;
      const move = (delta: number) => {
        e.preventDefault();
        const idx = ordered.findIndex((t) => t.id === selectedId);
        const next = ordered[Math.max(0, Math.min(ordered.length - 1, idx + delta))] ?? ordered[0];
        if (next) {
          setSelectedId(next.id);
          setExpandedId(null);
          document.querySelector(`[data-task-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
        }
      };

      switch (e.key) {
        case 'ArrowDown':
        case 'j':
          return move(1);
        case 'ArrowUp':
        case 'k':
          return move(-1);
        case 'Enter':
          if (selected) (e.preventDefault(), setExpandedId(expandedId === selected.id ? null : selected.id));
          return;
        case 'Escape':
          return expandedId ? setExpandedId(null) : setSelectedId(null);
        case 'n':
        case 'q':
          e.preventDefault();
          return openEntry();
        case '/':
          e.preventDefault();
          return setFindOpen(true);
        case '?':
          return setHelpOpen(true);
      }

      const digit = Number(e.key);
      if (digit >= 1 && digit <= LIST_KEYS.length) return navigate({ kind: LIST_KEYS[digit - 1]! });

      if (!selected) return;
      switch (e.key) {
        case 'x':
          return complete(selected);
        case 't':
          return applyWhen(selected, { kind: 'today' });
        case 'e':
          return applyWhen(selected, { kind: 'evening' });
        case 'a':
          return applyWhen(selected, { kind: 'anytime' });
        case 's':
          return applyWhen(selected, { kind: 'someday' });
        case 'w':
          return setPicker({ task: selected, mode: 'when' });
        case 'd':
          return setPicker({ task: selected, mode: 'deadline' });
        case 'Backspace':
        case 'Delete':
          if (window.confirm(t('task.deleteConfirm', { title: splitContent(selected.content).title }))) {
            void deleteTask(selected);
            move(1);
          }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ordered, selectedId, expandedId, picker, entry.open, findOpen, helpOpen, openEntry, navigate, complete, applyWhen]);

  // ---------- Drag & drop ----------
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } })
  );

  const moveToSection = (task: Task, key: string) => {
    if (key === 'evening') return applyWhen(task, { kind: 'evening' });
    if (key === 'today') return applyWhen(task, { kind: 'today' });
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return applyWhen(task, { kind: 'date', date: key });
    if (key === 'loose') return void updateTask(task, { metadata: { project_id: null } });
    if (projectsById.has(key)) return void updateTask(task, { metadata: { project_id: key } });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    const task = active.data.current?.task as Task | undefined;
    if (!task || !over || over.id === active.id) return;
    const overId = String(over.id);

    if (overId.startsWith('drop:')) {
      const target = overId.slice(5);
      const patch = dropPatch(task, target, projectsById);
      if (!patch) return;
      if (patch === 'complete') return complete(task);
      if (patch === 'pick-date') return setPicker({ task, mode: 'when' });
      return void updateTask(task, patch);
    }

    if (overId.startsWith('section:')) return moveToSection(task, overId.slice(8));

    const to = sections.find((s) => s.tasks.some((t) => t.id === overId));
    const from = sections.find((s) => s.tasks.some((t) => t.id === task.id));
    if (!to) return;
    if (from?.key !== to.key) moveToSection(task, to.key);

    const list = from?.key === to.key ? to.tasks : [...to.tasks, task];
    const reordered = arrayMove(list, list.findIndex((t) => t.id === task.id), list.findIndex((t) => t.id === overId));
    const idx = reordered.findIndex((t) => t.id === task.id);
    const before = reordered[idx - 1];
    const after = reordered[idx + 1];
    void updateTask(task, {
      metadata: { sort_order: orderBetween(before ? sortOrder(before) : null, after ? sortOrder(after) : null) }
    });
  };

  // If auth requires login and user is null (password/oidc mode) and we are online:
  const authData = authQuery.data;
  if (syncStatus.online && authData && (authData.mode === 'password' || authData.mode === 'oidc') && authData.user === null) {
    return (
      <LoginScreen
        auth={authData}
        onSuccess={() => {
          void authQuery.refetch();
          void me.refetch();
          void tasksQuery.refetch();
          void projectsQuery.refetch();
        }}
      />
    );
  }

  // ---------- Weergave ----------
  const renderRow = (task: Task, opts: { showProject: boolean; showWhen: boolean }) => <TaskRow key={task.id} task={task} {...opts} />;

  const header = (() => {
    if (!view) return null;
    if (view.kind === 'project') {
      const project = projectsById.get(view.id);
      return project ? <ProjectHeader project={project} onDone={() => navigate({ kind: 'anytime' })} /> : <ViewTitle icon={<Box size={26} className="text-zinc-400" />} title={t('quickFind.project')} />;
    }
    if (view.kind === 'area') {
      return <ViewTitle icon={<Box size={26} className="text-zinc-400" />} title={AREAS.find((a) => a.id === view.area)?.label ?? ''} />;
    }
    const { label, Icon, color } = LIST_META[view.kind];
    return <ViewTitle icon={<Icon size={26} className={`${color} ${view.kind === 'today' ? 'fill-amber-400' : ''}`} />} title={label} />;
  })();

  const emptyTextForView = (v: View): string => {
    if (v.kind === 'project') return t('empty.project');
    if (v.kind === 'area') return t('empty.area');
    switch (v.kind) {
      case 'inbox': return t('empty.inbox');
      case 'today': return t('empty.today');
      case 'upcoming': return t('empty.upcoming');
      case 'anytime': return t('empty.anytime');
      case 'someday': return t('empty.someday');
      case 'waiting': return t('empty.waiting');
      case 'logbook': return t('empty.logbook');
      default: return t('empty.none');
    }
  };

  const content = (() => {
    if (tasksQuery.isLoading) return <p className="p-10 text-sm text-zinc-400">{t('app.loadingTasks')}</p>;
    if (tasksQuery.isError && tasks.length === 0) {
      return (
        <div className="p-10 text-sm">
          <p className="text-rose-600">{t('app.loadTasksFailed', { error: tasksQuery.error.message })}</p>
          <button type="button" className="btn mt-3" onClick={() => tasksQuery.refetch()}>
            {t('app.retry')}
          </button>
        </div>
      );
    }
    if (!view) return null;
    if (view.kind === 'logbook') return <Logbook header={header} />;
    const areaProjects = view.kind === 'area' ? projects.filter((p) => p.visibility === view.area && p.status !== 'done') : [];
    return (
      <ListView
        header={header}
        sections={sections}
        renderRow={renderRow}
        showProject={view.kind !== 'project'}
        showWhen={view.kind !== 'today' && view.kind !== 'upcoming'}
        emptyText={emptyTextForView(view)}
      >
        {areaProjects.length > 0 && (
          <ul className="mb-6 space-y-1">
            {areaProjects.map((p) => {
              const open = tasks.filter((t) => projectId(t) === p.id && isOpen(t)).length;
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => navigate({ kind: 'project', id: p.id })} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800">
                    <Box size={16} className="text-sky-500" />
                    <span className="flex-1 truncate font-medium">{projectTitle(p)}</span>
                    <span className="text-xs text-zinc-400">{open}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </ListView>
    );
  })();

  const handleSessionLogin = () => {
    if (!authData) {
      window.location.assign('/api/login');
      return;
    }
    if (authData.mode === 'password') {
      void authQuery.refetch();
    } else if (authData.mode === 'oidc') {
      window.location.assign('/auth/oidc/login');
    } else {
      window.location.assign(authData.loginUrl ?? '/login');
    }
  };

  const showSidebar = isDesktop || route.kind === 'home';

  return (
    <UiContext.Provider value={ui}>
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={(e: DragStartEvent) => setDragging((e.active.data.current?.task as Task) ?? null)}
        onDragCancel={() => setDragging(null)}
        onDragEnd={onDragEnd}
      >
        <div className="flex min-h-dvh">
          {showSidebar && (
            <aside className={`${isDesktop ? 'sticky top-0 h-dvh w-64 shrink-0 border-r border-zinc-200 bg-zinc-100/70 dark:border-zinc-800 dark:bg-zinc-900/60' : 'w-full'}`}>
              {!isDesktop && (
                <div className="flex items-center justify-between px-5 pt-[max(1rem,env(safe-area-inset-top))]">
                  <h1 className="text-2xl font-bold">{t('app.name')}</h1>
                  <button type="button" onClick={() => setSettingsOpen(true)} className="icon-btn text-zinc-500" title={t('sidebar.settings')} aria-label={t('sidebar.settings')}>
                    <Settings size={20} />
                  </button>
                </div>
              )}
              <Sidebar
                route={route}
                tasks={tasks}
                projects={projects}
                today={today}
                onNavigate={navigate}
                onNewProject={newProject}
                onSearch={() => setFindOpen(true)}
                onOpenConflicts={() => setConflictDialogOpen(true)}
                onOpenSettings={() => setSettingsOpen(true)}
                user={authData?.user ?? me.data?.user}
              />
            </aside>
          )}
          {(isDesktop || route.kind !== 'home') && (
            <main className="min-w-0 flex-1" onClick={(e) => e.target === e.currentTarget && setExpandedId(null)}>
              {!isDesktop && (
                <div className="sticky top-0 z-20 flex items-center justify-between bg-[var(--surface)]/90 px-2 pb-1 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur">
                  <button type="button" onClick={() => navigate({ kind: 'home' })} className="flex items-center gap-0.5 py-1 text-sky-600">
                    <ChevronLeft size={22} /> {t('app.lists')}
                  </button>
                  <div className="pr-2">
                    <SyncIndicator onOpenConflicts={() => setConflictDialogOpen(true)} />
                  </div>
                </div>
              )}
              {syncStatus.authRequired && (
                <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
                  <span>{t('app.sessionExpired')}</span>
                  <button
                    type="button"
                    onClick={handleSessionLogin}
                    className="shrink-0 rounded bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white shadow hover:bg-amber-600"
                  >
                    {t('app.logIn')}
                  </button>
                </div>
              )}
              {content}
            </main>
          )}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging && (
            <div className="rounded-lg bg-white px-3 py-2 text-sm shadow-xl ring-1 ring-zinc-200 dark:bg-zinc-800 dark:ring-zinc-700">{splitContent(dragging.content).title}</div>
          )}
        </DragOverlay>
      </DndContext>

      <button
        type="button"
        onClick={openEntry}
        aria-label={t('task.newTask')}
        className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-6 z-30 grid size-14 place-items-center rounded-full bg-sky-500 text-white shadow-lg shadow-sky-500/30 transition-transform active:scale-95 md:size-12"
      >
        <Plus size={26} />
      </button>
      {isDesktop && (
        <button type="button" onClick={() => setHelpOpen(true)} className="fixed bottom-6 left-[17rem] z-30 icon-btn text-zinc-400" title={`${t('shortcuts.title')} (?)`}>
          <Keyboard size={18} />
        </button>
      )}

      <QuickEntry open={entry.open} defaults={entry.defaults} onClose={() => setEntry((s) => ({ ...s, open: false }))} />
      <QuickFind open={findOpen} onClose={() => setFindOpen(false)} tasks={tasks} projects={projects} onNavigate={navigate} onOpenTask={openTask} />
      <WhenPicker state={picker} onClose={() => setPicker(null)} onWhen={applyWhen} onDeadline={(task, date) => void updateTask(task, { metadata: { due_date: date } })} />
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <ConflictDialog open={conflictDialogOpen} onClose={() => setConflictDialogOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} auth={authData} />
      <Toasts />
    </UiContext.Provider>
  );
}

function ViewTitle({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-center gap-3">
      {icon}
      <h2 className="flex-1 text-[26px] font-bold tracking-tight">{title}</h2>
      {children}
    </div>
  );
}

function ProjectHeader({ project, onDone }: { project: Project; onDone: () => void }) {
  const { online } = useSyncStatus();
  const [title, setTitle] = useState(projectTitle(project));
  const [menu, setMenu] = useState(false);
  useEffect(() => setTitle(projectTitle(project)), [project]);
  const [first = '', ...rest] = project.content.split('\n');
  const body = rest.join('\n').trim();

  const rename = () => {
    if (!online) return;
    const current = projectTitle(project);
    if (!title.trim() || title.trim() === current) return setTitle(current);
    const prefix = first.match(/^(#+\\s*)?(Project:\\s*)?/i)?.[0] ?? '';
    void updateProject(project.id, { content: [`${prefix}${title.trim()}`, ...rest].join('\n') });
  };

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3">
        <Box size={26} className="shrink-0 text-sky-500" />
        <input
          disabled={!online}
          title={!online ? t('toast.offline') : undefined}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="min-w-0 flex-1 bg-transparent text-[26px] font-bold tracking-tight outline-none disabled:opacity-50"
        />
        <div className="relative">
          <button type="button" className="icon-btn" onClick={() => setMenu((m) => !m)} aria-label={t('project.menu')}>
            <MoreHorizontal size={20} />
          </button>
          {menu && (
            <div className="absolute right-0 z-30 mt-1 w-48 rounded-lg bg-white p-1 text-sm shadow-xl ring-1 ring-zinc-200 dark:bg-zinc-800 dark:ring-zinc-700" onMouseLeave={() => setMenu(false)}>
              <button
                type="button"
                disabled={!online}
                title={!online ? t('toast.offline') : undefined}
                className="menu-item disabled:opacity-50"
                onClick={() => {
                  if (!online) return;
                  void updateProject(project.id, { status: 'done' });
                  onDone();
                }}
              >
                <CheckCircle2 size={15} /> {t('project.complete')}
              </button>
              <button
                type="button"
                disabled={!online}
                title={!online ? t('toast.offline') : undefined}
                className="menu-item disabled:opacity-50"
                onClick={() => {
                  if (!online) return;
                  if (window.confirm(t('project.archiveConfirm'))) {
                    void updateProject(project.id, { status: 'archived' });
                    onDone();
                  }
                }}
              >
                <ArchiveIcon size={15} /> {t('project.archive')}
              </button>
            </div>
          )}
        </div>
      </div>
      {body && (
        <details className="mt-2 pl-9 text-sm text-zinc-500">
          <summary className="cursor-pointer text-xs">{t('project.notes')}</summary>
          <p className="mt-1 whitespace-pre-wrap">{body}</p>
        </details>
      )}
    </div>
  );
}

function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  useLang();
  const shortcuts: [string, string][] = [
    ['n', t('shortcuts.new')],
    ['/ of ⌘K', t('shortcuts.search')],
    ['↑ ↓ / j k', t('shortcuts.select')],
    ['↵', t('shortcuts.openClose')],
    ['Esc', t('shortcuts.close')],
    ['x', t('shortcuts.complete')],
    ['t', t('when.today')],
    ['e', t('when.thisEvening')],
    ['a', t('list.anytime')],
    ['s', t('when.someday')],
    ['w', t('task.whenDots')],
    ['d', t('task.deadlineDots')],
    ['⌫', t('shortcuts.delete')],
    ['1 – 7', t('shortcuts.listsRange')]
  ];

  return (
    <Modal open={open} onClose={onClose} label={t('shortcuts.title')} wide>
      <div className="p-5">
        <h2 className="mb-3 font-semibold">{t('shortcuts.title')}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          {shortcuts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800">{k}</kbd>
              </dt>
              <dd className="text-zinc-600 dark:text-zinc-300">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Modal>
  );
}

export type { Route };
