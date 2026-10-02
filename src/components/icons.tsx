import { Archive, BookCheck, CalendarDays, Hourglass, Inbox, Layers, Moon, Star, type LucideIcon } from 'lucide-react';
import type { ListKind } from '../lib/lists';
import { t } from '../i18n/index.js';

export const LIST_META: Record<ListKind, { readonly label: string; Icon: LucideIcon; color: string }> = {
  inbox: { get label() { return t('list.inbox'); }, Icon: Inbox, color: 'text-sky-500' },
  today: { get label() { return t('list.today'); }, Icon: Star, color: 'text-amber-400' },
  upcoming: { get label() { return t('list.upcoming'); }, Icon: CalendarDays, color: 'text-rose-500' },
  anytime: { get label() { return t('list.anytime'); }, Icon: Layers, color: 'text-teal-500' },
  someday: { get label() { return t('list.someday'); }, Icon: Archive, color: 'text-amber-700/70 dark:text-amber-300/70' },
  waiting: { get label() { return t('list.waiting'); }, Icon: Hourglass, color: 'text-violet-500' },
  logbook: { get label() { return t('list.logbook'); }, Icon: BookCheck, color: 'text-emerald-500' }
};

export const EveningIcon = Moon;

export function ProgressRing({ done, total, size = 16 }: { done: number; total: number; size?: number }) {
  const r = size / 2 - 1.5;
  const pct = total === 0 ? 0 : done / total;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 text-sky-500" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={1.5} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r / 2}
        fill="none"
        stroke="currentColor"
        strokeWidth={r}
        strokeDasharray={`${(pct * Math.PI * r).toFixed(2)} ${(Math.PI * r).toFixed(2)}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <title>{`${done}/${total}`}</title>
    </svg>
  );
}
