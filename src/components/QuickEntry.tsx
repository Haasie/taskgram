import { CalendarDays, Flag, Moon, Star, Archive, Inbox } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Visibility } from '../../shared/types.js';
import { formatShort, todayISO } from '../../shared/dates.js';
import { AREAS } from '../lib/lists';
import { createTask } from '../lib/queries';
import { joinContent } from '../lib/task';
import { whenPatch, type WhenChoice } from '../lib/when';
import { Calendar } from './Calendar';
import { Modal } from './Modal';
import { TagEditor } from './TagEditor';
import { projectTitle, useUi } from './UiContext';
import { t, useLang } from '../i18n/index.js';

export type QuickEntryDefaults = { when?: WhenChoice; projectId?: string; visibility?: Visibility };

export function QuickEntry({ open, defaults, onClose }: { open: boolean; defaults: QuickEntryDefaults; onClose: () => void }) {
  useLang();
  const ui = useUi();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [when, setWhen] = useState<WhenChoice>(defaults.when ?? { kind: 'inbox' });
  const [due, setDue] = useState<string | null>(null);
  const [projectId, setProjectId] = useState(defaults.projectId ?? '');
  const [visibility, setVisibility] = useState<Visibility>(defaults.visibility ?? 'personal');
  const [calendar, setCalendar] = useState<'when' | 'deadline' | null>(null);
  const [saving, setSaving] = useState(false);

  const whenOptions: { choice: WhenChoice; label: string; icon: React.ReactNode }[] = [
    { choice: { kind: 'inbox' }, label: t('list.inbox'), icon: <Inbox size={14} className="text-sky-500" /> },
    { choice: { kind: 'today' }, label: t('when.today'), icon: <Star size={14} className="fill-amber-400 text-amber-400" /> },
    { choice: { kind: 'evening' }, label: t('when.thisEvening'), icon: <Moon size={14} className="fill-sky-600 text-sky-600" /> },
    { choice: { kind: 'anytime' }, label: t('list.anytime'), icon: null },
    { choice: { kind: 'someday' }, label: t('when.someday'), icon: <Archive size={14} className="text-amber-700/70" /> }
  ];

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setNotes('');
    setTags([]);
    setDue(null);
    setCalendar(null);
    setWhen(defaults.when ?? { kind: 'inbox' });
    setProjectId(defaults.projectId ?? '');
    setVisibility(defaults.projectId ? ui.projectsById.get(defaults.projectId)?.visibility ?? 'personal' : defaults.visibility ?? 'personal');
  }, [open, defaults, ui.projectsById]);

  const submit = async (keepOpen = false) => {
    if (!title.trim() || saving) return;
    setSaving(true);
    // Een taak in een project of met datum hoort niet meer in de Inbox.
    const effective: WhenChoice = when.kind === 'inbox' && projectId ? { kind: 'anytime' } : when;
    const patch = whenPatch(effective, todayISO());
    const task = await createTask({
      content: joinContent(title, notes),
      status: patch.status,
      tags,
      visibility,
      metadata: {
        ...patch.metadata,
        ...(due ? { due_date: due } : {}),
        ...(projectId ? { project_id: projectId } : {})
      }
    });
    setSaving(false);
    if (!task) return;
    if (keepOpen) {
      setTitle('');
      setNotes('');
    } else onClose();
  };

  const whenText =
    when.kind === 'date' ? formatShort(when.date, ui.today) : whenOptions.find((o) => o.choice.kind === when.kind)?.label;

  return (
    <Modal open={open} onClose={onClose} label={t('task.newTask')} wide>
      <form
        className="space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('task.newTask')}
          className="w-full bg-transparent text-lg font-medium outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit(true);
            }
          }}
        />
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('task.notesPlaceholder')} rows={2} className="w-full resize-none bg-transparent text-sm outline-none" />
        <TagEditor tags={tags} allTags={ui.allTags} onChange={setTags} />

        <div className="flex flex-wrap gap-1.5">
          {whenOptions.map((o) => (
            <button key={o.label} type="button" onClick={() => (setWhen(o.choice), setCalendar(null))} className={`chip ${when.kind === o.choice.kind ? 'chip-active' : ''}`}>
              {o.icon}
              {o.label}
            </button>
          ))}
          <button type="button" onClick={() => setCalendar(calendar === 'when' ? null : 'when')} className={`chip ${when.kind === 'date' ? 'chip-active' : ''}`}>
            <CalendarDays size={14} /> {when.kind === 'date' ? whenText : t('when.dateDots')}
          </button>
          <button type="button" onClick={() => setCalendar(calendar === 'deadline' ? null : 'deadline')} className={`chip ${due ? 'chip-active' : ''}`}>
            <Flag size={14} /> {due ? formatShort(due, ui.today) : t('task.deadline')}
          </button>
        </div>
        {calendar && (
          <div className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
            <Calendar
              value={calendar === 'when' ? (when.kind === 'date' ? when.date : null) : due}
              onPick={(d) => {
                if (calendar === 'when') setWhen({ kind: 'date', date: d });
                else setDue(d);
                setCalendar(null);
              }}
            />
            {calendar === 'deadline' && due && (
              <button type="button" className="mt-2 text-xs text-rose-600" onClick={() => (setDue(null), setCalendar(null))}>
                {t('task.clearDeadline')}
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <select
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              const p = ui.projectsById.get(e.target.value);
              if (p) setVisibility(p.visibility);
            }}
            className="input"
            aria-label={t('task.project')}
          >
            <option value="">{t('task.noProject')}</option>
            {ui.projects
              .filter((p) => p.status !== 'done')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {projectTitle(p)}
                </option>
              ))}
          </select>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)} className="input" aria-label={t('task.area')}>
            {AREAS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <span className="mr-auto hidden text-xs text-zinc-400 sm:inline">{t('quickEntry.shortcutHelp')}</span>
          <button type="button" onClick={onClose} className="btn">
            {t('quickEntry.cancel')}
          </button>
          <button type="submit" disabled={!title.trim() || saving} className="btn btn-primary">
            {saving ? t('task.saving') : t('task.add')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
