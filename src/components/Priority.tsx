import { t } from '../i18n/index.js';
import type { TranslationKey } from '../i18n/index.js';

export const PRIORITY_LEVELS = [0, 1, 2, 3, 4, 5] as const;

const COLORS: Record<number, string> = {
  1: 'text-zinc-400',
  2: 'text-sky-600 dark:text-sky-400',
  3: 'text-amber-600 dark:text-amber-400',
  4: 'text-orange-600 dark:text-orange-400',
  5: 'text-rose-600 dark:text-rose-400'
};

export const priorityLabel = (p: number) => t(`priority.${p}` as TranslationKey);

/** Net als Vikunja alleen opvallend vanaf "hoog". */
export function PriorityBadge({ priority, always = false }: { priority: number; always?: boolean }) {
  if (!priority || (!always && priority < 3)) return null;
  return (
    <span className={`badge mt-0.5 shrink-0 font-semibold ${COLORS[priority]}`} title={`${t('priority.label')}: ${priorityLabel(priority)}`}>
      {'!'.repeat(Math.min(priority - 1, 3)) || '!'} {priorityLabel(priority)}
    </span>
  );
}

export function PrioritySelect({ value, onChange, className = 'input' }: { value: number; onChange: (p: number) => void; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className={className} aria-label={t('priority.label')}>
      {PRIORITY_LEVELS.map((p) => (
        <option key={p} value={p}>
          {priorityLabel(p)}
        </option>
      ))}
    </select>
  );
}
