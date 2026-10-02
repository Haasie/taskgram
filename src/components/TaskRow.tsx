import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Bell, Check, Flag, ListChecks, Moon, Repeat, StickyNote, Star } from 'lucide-react';
import { memo, useRef, useState, type PointerEvent } from 'react';
import type { Task } from '../../shared/types.js';
import { formatDeadline, formatShort } from '../../shared/dates.js';
import { reopenTask } from '../lib/queries';
import { checklist, deadline, isEvening, projectId, startDate } from '../../shared/taskFields.js';
import { splitContent } from '../lib/task';
import { TaskEditor } from './TaskEditor';
import { projectTitle, useUi } from './UiContext';
import { t, useLang } from '../i18n/index.js';

type Props = { task: Task; showProject?: boolean; showWhen?: boolean; sortable?: boolean };

const SWIPE_TRIGGER = 72;

export const TaskRow = memo(function TaskRow({ task, showProject = false, showWhen = false, sortable = true }: Props) {
  useLang();
  const ui = useUi();
  const expanded = ui.expandedId === task.id;
  const selected = ui.selectedId === task.id;
  const [checking, setChecking] = useState(false);
  const [dx, setDx] = useState(0);
  const swipe = useRef<{ x: number; y: number; active: boolean } | null>(null);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !sortable || expanded,
    data: { task }
  });

  const { title, notes } = splitContent(task.content);
  const items = checklist(task);
  const due = deadline(task);
  const start = startDate(task);
  const project = projectId(task) ? ui.projectsById.get(projectId(task)!) : undefined;
  const done = task.status === 'done' || checking;

  const toggle = () => {
    if (task.status === 'done') {
      void reopenTask(task.id);
      return;
    }
    if (checking) {
      setChecking(false);
      return;
    }
    setChecking(true);
    // Things laat een afgevinkte taak nog even staan voordat hij verdwijnt.
    setTimeout(() => setChecking((still) => (still && ui.complete(task), false)), 900);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || expanded) return;
    swipe.current = { x: e.clientX, y: e.clientY, active: false };
  };
  const onPointerMove = (e: PointerEvent) => {
    const s = swipe.current;
    if (!s) return;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;
    if (!s.active && Math.abs(mx) > 12 && Math.abs(mx) > Math.abs(my) * 1.5) s.active = true;
    if (s.active) setDx(Math.max(-140, Math.min(140, mx)));
  };
  const onPointerUp = () => {
    if (swipe.current?.active) {
      if (dx > SWIPE_TRIGGER) ui.openPicker({ task, mode: 'when' });
      else if (dx < -SWIPE_TRIGGER) toggle();
    }
    swipe.current = null;
    setDx(0);
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`relative list-none ${isDragging ? 'z-10 opacity-60' : ''}`}
      data-task-id={task.id}
    >
      {dx !== 0 && (
        <div className={`absolute inset-0 flex items-center rounded-lg px-4 text-sm font-medium text-white ${dx > 0 ? 'justify-start bg-amber-400' : 'justify-end bg-emerald-500'}`}>
          {dx > 0 ? t('task.whenDots') : task.status === 'done' ? t('task.reopen') : t('task.complete')}
        </div>
      )}
      <div
        {...(expanded ? {} : attributes)}
        {...(expanded ? {} : listeners)}
        role={expanded ? undefined : 'button'}
        aria-disabled={undefined}
        tabIndex={expanded ? undefined : -1}
        onPointerDownCapture={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={() => (selected || expanded ? ui.expand(expanded ? null : task.id) : ui.select(task.id))}
        onDoubleClick={() => ui.expand(task.id)}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        className={`relative touch-pan-y rounded-lg outline-none px-2 transition-[background-color,box-shadow,margin] ${
          expanded
            ? 'my-3 bg-white px-4 py-3 shadow-[0_2px_12px_rgba(0,0,0,0.12)] ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700 cursor-default'
            : selected
              ? 'bg-sky-100 dark:bg-sky-900/40'
              : 'bg-[var(--surface)] hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
        }`}
      >
        <div className={`flex items-start gap-3 ${expanded ? 'mb-2' : 'py-[7px]'}`}>
          <button
            type="button"
            role="checkbox"
            aria-checked={done}
            aria-label={done ? t('task.toggleOpen') : t('task.complete')}
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={`mt-[3px] grid size-[15px] shrink-0 place-items-center rounded-[4px] border-[1.5px] transition-colors ${
              done ? 'border-sky-500 bg-sky-500 text-white' : due && due < ui.today ? 'border-rose-400' : 'border-zinc-400 dark:border-zinc-500'
            }`}
          >
            {done && <Check size={11} strokeWidth={3.5} />}
          </button>
          {expanded ? (
            <div className="min-w-0 flex-1">
              <TaskEditor task={task} />
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-1.5">
                {showWhen && start && start <= ui.today && task.status !== 'someday' && (
                  isEvening(task) ? <Moon size={13} className="mt-[3px] shrink-0 fill-sky-600 text-sky-600" /> : <Star size={13} className="mt-[3px] shrink-0 fill-amber-400 text-amber-400" />
                )}
                {showWhen && start && start > ui.today && <span className="badge mt-0.5">{formatShort(start, ui.today)}</span>}
                {task.status === 'waiting' && <span className="badge mt-0.5 text-violet-600">{t('task.waitingBadge')}</span>}
                <span className={`line-clamp-2 text-[15px] leading-snug ${done ? 'text-zinc-400 line-through decoration-zinc-300' : ''}`}>{title || t('task.untitled')}</span>
                {task.metadata.reminder_time && <Bell size={12} className="mt-1 shrink-0 text-zinc-300" />}
                {task.metadata.recurrence && <Repeat size={12} className="mt-1 shrink-0 text-zinc-300" />}
                {notes && <StickyNote size={12} className="mt-1 shrink-0 text-zinc-300" />}
                {items.length > 0 && (
                  <span className="mt-0.5 inline-flex shrink-0 items-center gap-0.5 text-xs text-zinc-400">
                    <ListChecks size={12} />
                    {items.filter((i) => i.done).length}/{items.length}
                  </span>
                )}
              </div>
              {(showProject && project) || task.tags.length > 0 || due ? (
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-400">
                  {showProject && project && <span className="truncate">{projectTitle(project)}</span>}
                  {task.tags.slice(0, 4).map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                  {task.tags.length > 4 && <span>+{task.tags.length - 4}</span>}
                  {due && (
                    <span className={`inline-flex items-center gap-1 ${due <= ui.today ? 'font-medium text-rose-500' : ''}`}>
                      <Flag size={11} /> {due < ui.today ? formatDeadline(due, ui.today) : formatShort(due, ui.today)}
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </li>
  );
});
