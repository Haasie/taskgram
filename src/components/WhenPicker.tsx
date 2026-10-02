import { Archive, Hourglass, Inbox, Layers, Moon, Star, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Task } from '../../shared/types.js';
import { addDays, todayISO } from '../../shared/dates.js';
import { deadline, startDate } from '../../shared/taskFields.js';
import type { WhenChoice } from '../lib/when';
import { Calendar } from './Calendar';
import { Modal } from './Modal';
import { t, useLang } from '../i18n/index.js';

export type PickerState = { task: Task; mode: 'when' | 'deadline' } | null;

type Props = {
  state: PickerState;
  onClose: () => void;
  onWhen: (task: Task, choice: WhenChoice) => void;
  onDeadline: (task: Task, date: string | null) => void;
};

function Option({ icon, label, onClick, hint }: { icon: ReactNode; label: string; onClick: () => void; hint?: string }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[15px] hover:bg-zinc-100 dark:hover:bg-zinc-800">
      {icon}
      <span className="flex-1">{label}</span>
      {hint && <kbd className="text-xs text-zinc-400">{hint}</kbd>}
    </button>
  );
}

export function WhenPicker({ state, onClose, onWhen, onDeadline }: Props) {
  useLang();
  if (!state) return null;
  const { task, mode } = state;
  const today = todayISO();
  const pick = (choice: WhenChoice) => {
    onWhen(task, choice);
    onClose();
  };

  if (mode === 'deadline') {
    const current = deadline(task);
    return (
      <Modal open onClose={onClose} label={t('task.deadline')}>
        <div className="p-4">
          <h2 className="mb-3 text-center text-sm font-semibold text-zinc-500">{t('task.deadline')}</h2>
          <Calendar value={current} onPick={(d) => (onDeadline(task, d), onClose())} />
          {current && (
            <button type="button" className="mt-3 w-full rounded-lg py-2 text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-zinc-800" onClick={() => (onDeadline(task, null), onClose())}>
              {t('task.clearDeadline')}
            </button>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} label={t('when.title')}>
      <div className="p-3">
        <h2 className="mb-2 text-center text-sm font-semibold text-zinc-500">{t('when.whenQuestion')}</h2>
        <Option icon={<Star size={18} className="fill-amber-400 text-amber-400" />} label={t('when.today')} hint="T" onClick={() => pick({ kind: 'today' })} />
        <Option icon={<Moon size={18} className="fill-sky-600 text-sky-600" />} label={t('when.thisEvening')} hint="E" onClick={() => pick({ kind: 'evening' })} />
        <div className="my-2 px-1">
          <Calendar value={startDate(task)} onPick={(date) => pick({ kind: 'date', date })} />
          <div className="mt-2 flex gap-2 text-sm">
            <button type="button" className="chip" onClick={() => pick({ kind: 'date', date: addDays(today, 1) })}>{t('when.tomorrow')}</button>
            <button type="button" className="chip" onClick={() => pick({ kind: 'date', date: nextWeekday(today, 6) })}>{t('when.thisWeekend')}</button>
            <button type="button" className="chip" onClick={() => pick({ kind: 'date', date: nextWeekday(today, 1) })}>{t('when.nextWeek')}</button>
          </div>
        </div>
        <Option icon={<Layers size={18} className="text-teal-500" />} label={t('list.anytime')} hint="A" onClick={() => pick({ kind: 'anytime' })} />
        <Option icon={<Archive size={18} className="text-amber-700/70" />} label={t('when.someday')} hint="S" onClick={() => pick({ kind: 'someday' })} />
        <Option icon={<Hourglass size={18} className="text-violet-500" />} label={t('list.waiting')} onClick={() => pick({ kind: 'waiting' })} />
        <Option icon={<Inbox size={18} className="text-sky-500" />} label={t('when.backToInbox')} onClick={() => pick({ kind: 'inbox' })} />
        <Option icon={<X size={18} className="text-zinc-400" />} label={t('quickEntry.cancel')} onClick={onClose} />
      </div>
    </Modal>
  );
}

/** Eerstvolgende gegeven weekdag (0=zo … 6=za), altijd in de toekomst. */
function nextWeekday(fromISO: string, weekday: number) {
  const [y, m, d] = fromISO.split('-').map(Number);
  const date = new Date(y!, m! - 1, d!);
  const diff = (weekday - date.getDay() + 7) % 7 || 7;
  return addDays(fromISO, diff);
}
