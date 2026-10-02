import { AlertTriangle, X } from 'lucide-react';
import { resolveConflict, useSyncStatus } from '../lib/sync';
import { Modal } from './Modal';
import { t, useLang } from '../i18n/index.js';

export function ConflictDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useLang();
  const { conflicts } = useSyncStatus();

  const kindLabels: Record<string, string> = {
    update: t('conflicts.kind.update'),
    complete: t('conflicts.kind.complete'),
    reopen: t('conflicts.kind.reopen'),
    delete: t('conflicts.kind.delete')
  };

  return (
    <Modal open={open} onClose={onClose} label={t('conflicts.title')} wide>
      <div className="p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle size={18} className="text-amber-500" />
            <span>{t('conflicts.titleWithCount', { count: conflicts.length })}</span>
          </div>
          <button type="button" onClick={onClose} className="icon-btn text-zinc-400" aria-label={t('conflicts.close')}>
            <X size={18} />
          </button>
        </div>

        {conflicts.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-400">{t('conflicts.empty')}</p>
        ) : (
          <ul className="space-y-3">
            {conflicts.map((conflict) => {
              const timeStr = new Date(conflict.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const kindLabel = kindLabels[conflict.kind] ?? conflict.kind;

              return (
                <li
                  key={conflict.id}
                  className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-800/50"
                >
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{conflict.title}</span>
                    <span className="shrink-0 text-xs text-zinc-400">{timeStr}</span>
                  </div>
                  <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
                    {t('conflicts.type')}<span className="font-medium text-zinc-700 dark:text-zinc-300">{kindLabel}</span>
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => void resolveConflict(conflict.id, 'discard')}
                      className="rounded-md px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    >
                      {t('conflicts.discard')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void resolveConflict(conflict.id, 'apply')}
                      className="rounded-md bg-sky-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-600 shadow-sm"
                    >
                      {t('conflicts.apply')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
