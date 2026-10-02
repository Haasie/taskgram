import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { parseISODate, toISODate, todayISO } from '../../shared/dates.js';
import { t, useLang } from '../i18n/index.js';

export function Calendar({ value, onPick }: { value: string | null; onPick: (iso: string) => void }) {
  const lang = useLang();
  const today = todayISO();
  const [cursor, setCursor] = useState(() => {
    const d = parseISODate(value ?? today);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const weekdays = lang === 'nl' ? ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'] : ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const monthLocale = lang === 'nl' ? 'nl-NL' : 'en-GB';
  const monthFmt = new Intl.DateTimeFormat(monthLocale, { month: 'long', year: 'numeric' });

  const offset = (cursor.getDay() + 6) % 7;
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - offset);
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const shift = (n: number) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1));

  return (
    <div className="select-none">
      <div className="flex items-center justify-between px-1 pb-2">
        <button type="button" className="icon-btn" onClick={() => shift(-1)} aria-label={t('calendar.prevMonth')}>
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-semibold capitalize">{monthFmt.format(cursor)}</span>
        <button type="button" className="icon-btn" onClick={() => shift(1)} aria-label={t('calendar.nextMonth')}>
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
        {weekdays.map((d) => (
          <div key={d} className="py-1 text-zinc-400">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const iso = toISODate(d);
          const inMonth = d.getMonth() === cursor.getMonth();
          const past = iso < today;
          return (
            <button
              key={iso}
              type="button"
              disabled={past}
              onClick={() => onPick(iso)}
              className={`h-8 rounded-md text-sm transition-colors ${
                iso === value
                  ? 'bg-sky-500 text-white'
                  : iso === today
                    ? 'font-bold text-sky-600 hover:bg-sky-50 dark:hover:bg-zinc-800'
                    : inMonth
                      ? 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              } disabled:opacity-30 disabled:hover:bg-transparent`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
