import { AlertCircle, CloudOff, RefreshCw } from 'lucide-react';
import { useSyncStatus } from '../lib/sync';
import { t, tn, useLang } from '../i18n/index.js';

export function SyncIndicator({ onOpenConflicts }: { onOpenConflicts?: () => void }) {
  useLang();
  const status = useSyncStatus();

  if (status.conflicts.length > 0) {
    const label = tn('sync.conflicts', status.conflicts.length);
    return (
      <button
        type="button"
        onClick={onOpenConflicts}
        className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-medium text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40"
        title={t('sync.viewConflicts')}
      >
        <AlertCircle size={14} />
        <span className="underline decoration-amber-400 underline-offset-2">{label}</span>
      </button>
    );
  }

  if (status.pending > 0) {
    const label = tn('sync.pending', status.pending);
    return (
      <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        <RefreshCw size={14} />
        <span>{label}</span>
      </div>
    );
  }

  if (!status.online) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-zinc-400" title={t('sync.offline')}>
        <CloudOff size={14} />
        <span>{t('sync.offline')}</span>
      </div>
    );
  }

  if (status.syncing) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-sky-600 dark:text-sky-400">
        <RefreshCw size={14} className="animate-spin" />
        <span>{t('sync.syncing')}</span>
      </div>
    );
  }

  return null;
}
