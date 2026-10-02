import { useState, useEffect } from 'react';
import type { RecurrenceRule, Task } from '../../shared/types.js';
import { describeRule } from '../../shared/recurrence.js';
import { updateTask } from '../lib/queries';
import { Modal } from './Modal';
import { t, useLang } from '../i18n/index.js';

type Props = {
  task: Task;
  open: boolean;
  onClose: () => void;
};

const WEEKDAYS_NL = [
  { label: 'ma', value: 1 },
  { label: 'di', value: 2 },
  { label: 'wo', value: 3 },
  { label: 'do', value: 4 },
  { label: 'vr', value: 5 },
  { label: 'za', value: 6 },
  { label: 'zo', value: 0 }
];

const WEEKDAYS_EN = [
  { label: 'Mo', value: 1 },
  { label: 'Tu', value: 2 },
  { label: 'We', value: 3 },
  { label: 'Th', value: 4 },
  { label: 'Fr', value: 5 },
  { label: 'Sa', value: 6 },
  { label: 'Su', value: 0 }
];

export function RecurrenceEditor({ task, open, onClose }: Props) {
  const lang = useLang();
  const current = task.metadata.recurrence ?? null;

  const [kind, setKind] = useState<'none' | 'daily' | 'weekly' | 'monthly' | 'after_completion'>(
    current ? current.type : 'none'
  );
  const [dailyInterval, setDailyInterval] = useState(current?.type === 'daily' ? current.interval : 1);
  const [weeklyInterval, setWeeklyInterval] = useState(current?.type === 'weekly' ? current.interval : 1);
  const [weekdays, setWeekdays] = useState<number[]>(
    current?.type === 'weekly' ? current.weekdays : [new Date().getDay()]
  );
  const [monthlyInterval, setMonthlyInterval] = useState(current?.type === 'monthly' ? current.interval : 1);
  const [monthlyDay, setMonthlyDay] = useState(current?.type === 'monthly' ? current.day : new Date().getDate());
  const [afterEvery, setAfterEvery] = useState(current?.type === 'after_completion' ? current.every : 1);
  const [afterUnit, setAfterUnit] = useState<'day' | 'week'>(
    current?.type === 'after_completion' ? current.unit : 'day'
  );

  useEffect(() => {
    if (open) {
      const rec = task.metadata.recurrence ?? null;
      setKind(rec ? rec.type : 'none');
      if (rec?.type === 'daily') setDailyInterval(rec.interval);
      if (rec?.type === 'weekly') {
        setWeeklyInterval(rec.interval);
        setWeekdays(rec.weekdays);
      }
      if (rec?.type === 'monthly') {
        setMonthlyInterval(rec.interval);
        setMonthlyDay(rec.day);
      }
      if (rec?.type === 'after_completion') {
        setAfterEvery(rec.every);
        setAfterUnit(rec.unit);
      }
    }
  }, [open, task.metadata.recurrence]);

  let activeRule: RecurrenceRule | null = null;
  if (kind === 'daily') {
    activeRule = { type: 'daily', interval: Math.max(1, dailyInterval || 1) };
  } else if (kind === 'weekly') {
    const selectedDays = weekdays.length > 0 ? weekdays : [1];
    activeRule = {
      type: 'weekly',
      interval: Math.max(1, weeklyInterval || 1),
      weekdays: [...new Set(selectedDays)].sort((a, b) => a - b)
    };
  } else if (kind === 'monthly') {
    activeRule = {
      type: 'monthly',
      interval: Math.max(1, monthlyInterval || 1),
      day: Math.min(31, Math.max(1, monthlyDay || 1))
    };
  } else if (kind === 'after_completion') {
    activeRule = {
      type: 'after_completion',
      every: Math.max(1, afterEvery || 1),
      unit: afterUnit
    };
  }

  const toggleWeekday = (day: number) => {
    setWeekdays((prev) => {
      if (prev.includes(day)) {
        if (prev.length <= 1) return prev; // keep at least one
        return prev.filter((d) => d !== day);
      }
      return [...prev, day];
    });
  };

  const handleSave = () => {
    void updateTask(task, { metadata: { recurrence: activeRule } });
    onClose();
  };

  const handleDelete = () => {
    void updateTask(task, { metadata: { recurrence: null } });
    onClose();
  };

  const weekdayList = lang === 'nl' ? WEEKDAYS_NL : WEEKDAYS_EN;

  return (
    <Modal open={open} onClose={onClose} label={t('recurrence.title')}>
      <div className="p-4 space-y-4">
        <h2 className="text-center text-sm font-semibold text-zinc-500">{t('when.repeat')}</h2>

        <div>
          <label className="section-label mb-1 block">{t('recurrence.frequency')}</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            className="input w-full"
          >
            <option value="none">{t('recurrence.none')}</option>
            <option value="daily">{t('recurrence.daily')}</option>
            <option value="weekly">{t('recurrence.weekly')}</option>
            <option value="monthly">{t('recurrence.monthly')}</option>
            <option value="after_completion">{t('recurrence.afterCompletion')}</option>
          </select>
        </div>

        {kind === 'daily' && (
          <div>
            <label className="section-label mb-1 block">{t('recurrence.everyNDays')}</label>
            <input
              type="number"
              min={1}
              max={365}
              value={dailyInterval}
              onChange={(e) => setDailyInterval(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="input w-full"
            />
          </div>
        )}

        {kind === 'weekly' && (
          <div className="space-y-3">
            <div>
              <label className="section-label mb-1 block">{t('recurrence.everyNWeeks')}</label>
              <input
                type="number"
                min={1}
                max={52}
                value={weeklyInterval}
                onChange={(e) => setWeeklyInterval(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="input w-full"
              />
            </div>
            <div>
              <label className="section-label mb-1 block">{t('recurrence.weekdays')}</label>
              <div className="flex justify-between gap-1">
                {weekdayList.map(({ label, value }) => {
                  const selected = weekdays.includes(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => toggleWeekday(value)}
                      className={`h-9 w-9 rounded-full text-xs font-medium transition-colors ${
                        selected
                          ? 'bg-sky-600 text-white'
                          : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {kind === 'monthly' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="section-label mb-1 block">{t('recurrence.everyNMonths')}</label>
              <input
                type="number"
                min={1}
                max={12}
                value={monthlyInterval}
                onChange={(e) => setMonthlyInterval(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="input w-full"
              />
            </div>
            <div>
              <label className="section-label mb-1 block">{t('recurrence.monthDay')}</label>
              <input
                type="number"
                min={1}
                max={31}
                value={monthlyDay}
                onChange={(e) => setMonthlyDay(Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                className="input w-full"
              />
            </div>
          </div>
        )}

        {kind === 'after_completion' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="section-label mb-1 block">{t('recurrence.count')}</label>
              <input
                type="number"
                min={1}
                max={365}
                value={afterEvery}
                onChange={(e) => setAfterEvery(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="input w-full"
              />
            </div>
            <div>
              <label className="section-label mb-1 block">{t('recurrence.unit')}</label>
              <select
                value={afterUnit}
                onChange={(e) => setAfterUnit(e.target.value as 'day' | 'week')}
                className="input w-full"
              >
                <option value="day">{t('recurrence.days')}</option>
                <option value="week">{t('recurrence.weeks')}</option>
              </select>
            </div>
          </div>
        )}

        {activeRule && (
          <div className="rounded-lg bg-zinc-50 p-2.5 text-center text-xs font-medium text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-300">
            {describeRule(activeRule, lang)}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          {current ? (
            <button
              type="button"
              onClick={handleDelete}
              className="text-xs text-rose-600 hover:underline"
            >
              {t('task.deleteTask')}
            </button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              {t('quickEntry.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
            >
              {t('task.save')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
