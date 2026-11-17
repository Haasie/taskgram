import { RefreshCw, X } from 'lucide-react';
import { t } from '../i18n';
import { dismissUpdateBar, useUpdateBarVisible } from '../lib/updateStore';
import { reloadNow } from '../lib/updates';

/** Blijvend balkje zodra er een nieuwe versie klaarstaat: woord + pictogram, niet alleen kleur. */
export function UpdateBar() {
  const visible = useUpdateBarVisible();
  if (!visible) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="update-bar"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(6.25rem+env(safe-area-inset-bottom))] z-[61] flex justify-center px-4 md:bottom-20"
    >
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-1 rounded-md border-2 border-sky-600 bg-[var(--surface)] py-1 pl-3 pr-1 text-sm shadow-lg animate-sheet dark:border-sky-400">
        <RefreshCw size={16} aria-hidden className="mr-1 shrink-0 text-sky-600 dark:text-sky-400" />
        <span className="min-w-0 flex-1 font-medium">{t('update.available')}</span>
        <button type="button" onClick={reloadNow} className="min-h-11 rounded-md bg-sky-600 px-4 font-semibold text-white hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-600">
          {t('update.reload')}
        </button>
        <button
          type="button"
          onClick={dismissUpdateBar}
          title={t('update.later')}
          aria-label={t('update.later')}
          className="grid size-11 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <X size={18} aria-hidden />
        </button>
      </div>
    </div>
  );
}
