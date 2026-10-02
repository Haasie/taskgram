import { Bell, CalendarDays, Flag, ListChecks, Moon, Repeat, Star, Tag, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ChecklistItem, Task, Visibility } from '../../shared/types.js';
import { formatDeadline, formatShort } from '../../shared/dates.js';
import { describeRule } from '../../shared/recurrence.js';
import { AREAS } from '../lib/lists';
import { deleteTask, updateTask } from '../lib/queries';
import { checklist, deadline, isEvening, projectId, startDate } from '../../shared/taskFields.js';
import { joinContent, newId, splitContent } from '../lib/task';
import { showToast } from '../lib/toast';
import { Checklist } from './Checklist';
import { LinkedKnowledge } from './LinkedKnowledge';
import { RecurrenceEditor } from './RecurrenceEditor';
import { TagEditor } from './TagEditor';
import { projectTitle, useUi } from './UiContext';
import { t, useLang } from '../i18n/index.js';

function useAutosize(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}

export function TaskEditor({ task }: { task: Task }) {
  const lang = useLang();
  const ui = useUi();
  const initial = splitContent(task.content);
  const [title, setTitle] = useState(initial.title);
  const [notes, setNotes] = useState(initial.notes);
  const [showTags, setShowTags] = useState(task.tags.length > 0);
  const [showRecurrence, setShowRecurrence] = useState(false);
  const [context, setContext] = useState(typeof task.metadata.context === 'string' ? task.metadata.context : '');
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef({ title, notes });
  contentRef.current = { title, notes };
  useAutosize(notesRef, notes);
  useAutosize(titleRef, title);

  const save = () => {
    const { title: t, notes: n } = contentRef.current;
    const next = joinContent(t || initial.title || 'Nieuwe taak', n);
    if (next !== task.content) void updateTask(task, { content: next });
  };

  // Opslaan bij inklappen.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => () => saveRef.current(), []);

  const items = checklist(task);
  const setChecklist = (next: ChecklistItem[]) => void updateTask(task, { metadata: { checklist: next.length ? next : null } });
  const start = startDate(task);
  const due = deadline(task);
  const pid = projectId(task);

  const remove = () => {
    void deleteTask(task);
    ui.expand(null);
    showToast(t('toast.taskDeleted'));
  };

  return (
    <div className="space-y-3 pb-1" onClick={(e) => e.stopPropagation()}>
      <textarea
        ref={titleRef}
        rows={1}
        autoFocus={!initial.title}
        value={title}
        onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            notesRef.current?.focus();
          }
        }}
        className="w-full resize-none bg-transparent text-[15px] font-medium leading-snug outline-none"
        placeholder={t('task.newTask')}
      />
      <textarea
        ref={notesRef}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={save}
        rows={1}
        placeholder={t('task.notesPlaceholder')}
        className="w-full resize-none bg-transparent text-sm leading-relaxed text-zinc-600 outline-none placeholder:text-zinc-400 dark:text-zinc-300"
      />

      {items.length > 0 && <Checklist items={items} onChange={setChecklist} />}

      {showTags && <TagEditor tags={task.tags} allTags={ui.allTags} onChange={(tags) => void updateTask(task, { tags })} />}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(start || task.status === 'someday' || task.status === 'waiting') && (
          <button type="button" className="chip" onClick={() => ui.openPicker({ task, mode: 'when' })}>
            {start && start <= ui.today ? (
              isEvening(task) ? <Moon size={13} className="fill-sky-600 text-sky-600" /> : <Star size={13} className="fill-amber-400 text-amber-400" />
            ) : (
              <CalendarDays size={13} />
            )}
            {task.status === 'someday' ? t('list.someday') : task.status === 'waiting' ? t('list.waiting') : formatShort(start!, ui.today)}
          </button>
        )}
        {due && (
          <button type="button" className={`chip ${due <= ui.today ? 'text-rose-600' : ''}`} onClick={() => ui.openPicker({ task, mode: 'deadline' })}>
            <Flag size={13} /> {t('task.deadline')}: {formatShort(due, ui.today)} · {formatDeadline(due, ui.today)}
          </button>
        )}
        {(start || due) && (
          <label className="chip cursor-pointer gap-1.5" title={t('when.reminder')}>
            <Bell size={13} className="text-zinc-400" />
            <span>{t('when.reminder')}</span>
            <input
              type="time"
              value={task.metadata.reminder_time ?? ''}
              onChange={(e) => void updateTask(task, { metadata: { reminder_time: e.target.value || null } })}
              className="bg-transparent text-xs outline-none"
            />
          </label>
        )}
        {task.metadata.recurrence && (
          <button type="button" className="chip" onClick={() => setShowRecurrence(true)}>
            <Repeat size={13} /> {describeRule(task.metadata.recurrence, lang)}
          </button>
        )}
        <div className="ml-auto flex items-center gap-0.5 text-zinc-400">
          <button type="button" className="icon-btn" title={t('task.when')} onClick={() => ui.openPicker({ task, mode: 'when' })}>
            <CalendarDays size={17} />
          </button>
          <button type="button" className="icon-btn" title={t('task.repeat')} onClick={() => setShowRecurrence(true)}>
            <Repeat size={17} />
          </button>
          <button type="button" className="icon-btn" title={t('task.tags')} onClick={() => setShowTags(true)}>
            <Tag size={17} />
          </button>
          <button type="button" className="icon-btn" title={t('task.checklist')} onClick={() => items.length === 0 && setChecklist([{ id: newId(), text: '', done: false }])}>
            <ListChecks size={17} />
          </button>
          <button type="button" className="icon-btn" title={t('task.deadline')} onClick={() => ui.openPicker({ task, mode: 'deadline' })}>
            <Flag size={17} />
          </button>
        </div>
      </div>

      <details className="rounded-lg border border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <summary className="cursor-pointer text-xs font-medium text-zinc-500">{t('task.detailsSummary')}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="field">
            <span className="section-label">{t('task.project')}</span>
            <select
              value={pid ?? ''}
              onChange={(e) => {
                const next = e.target.value || null;
                const project = next ? ui.projectsById.get(next) : undefined;
                void updateTask(task, {
                  metadata: { project_id: next },
                  ...(project ? { visibility: project.visibility } : {})
                });
              }}
              className="input"
            >
              <option value="">{t('task.noProject')}</option>
              {AREAS.map((area) => {
                const inArea = ui.projects.filter((p) => p.visibility === area.id && p.status !== 'done');
                return inArea.length ? (
                  <optgroup key={area.id} label={area.label}>
                    {inArea.map((p) => (
                      <option key={p.id} value={p.id}>
                        {projectTitle(p)}
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              })}
            </select>
          </label>
          <label className="field">
            <span className="section-label">{t('task.area')}</span>
            <select value={task.visibility} onChange={(e) => void updateTask(task, { visibility: e.target.value as Visibility })} className="input">
              {AREAS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field sm:col-span-2">
            <span className="section-label">{t('task.context')}</span>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              onBlur={() => context !== (task.metadata.context ?? '') && void updateTask(task, { metadata: { context: context || null } })}
              rows={2}
              className="input resize-y"
              placeholder={t('task.contextPlaceholder')}
            />
          </label>
        </div>
        <div className="mt-3">
          <LinkedKnowledge taskId={task.id} />
        </div>
        {typeof task.metadata.source === 'string' && <p className="mt-3 text-xs text-zinc-400">{t('task.source', { source: task.metadata.source })}</p>}
        <button type="button" onClick={remove} className="mt-3 inline-flex items-center gap-1.5 text-xs text-rose-600 hover:underline">
          <Trash2 size={13} /> {t('task.deleteTask')}
        </button>
      </details>

      {showRecurrence && (
        <RecurrenceEditor task={task} open={showRecurrence} onClose={() => setShowRecurrence(false)} />
      )}
    </div>
  );
}
