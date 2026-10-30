import { Suspense, useEffect } from 'react';
import { CLIENT_MODULES, useModuleStates } from '../lib/modules';
import { ErrorBoundary } from './ErrorBoundary';
import { t } from '../i18n/index.js';

/** Toont een module alleen als hij aan staat; anders bestaat de route niet en gaan we terug. */
export function ModuleOutlet({ id, today, onClose }: { id: string; today: string; onClose: () => void }) {
  const states = useModuleStates();
  const mod = CLIENT_MODULES.find((m) => m.id === id);
  const enabled = Boolean(mod && states.data?.[id]);
  const known = states.data !== undefined;

  useEffect(() => {
    if (known && !enabled) onClose();
  }, [known, enabled, onClose]);

  if (!known) {
    return states.isError ? (
      <p className="p-10 text-sm text-rose-600">{t('modules.loadFailed')}</p>
    ) : (
      <p className="p-10 text-sm text-zinc-400">{t('modules.loading')}</p>
    );
  }
  if (!mod || !enabled) return null;
  return (
    <ErrorBoundary>
      <Suspense fallback={<p className="p-10 text-sm text-zinc-400">{t('modules.loading')}</p>}>
        <mod.View today={today} />
      </Suspense>
    </ErrorBoundary>
  );
}
