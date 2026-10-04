import { Component, type ReactNode } from 'react';
import { del } from 'idb-keyval';
import { APP_NAME } from '../../shared/brand.js';
import { t } from '../i18n';

type State = { error: Error | null; recovering: boolean };

/**
 * Laatste vangnet: als het renderen faalt (bijv. door verouderde offline gegevens na een
 * update) tonen we een herstelscherm in plaats van een wit scherm. Herstellen wist alleen de
 * offline kopie van de lijsten en de app-cache; de wachtrij met niet-gesynchroniseerde
 * wijzigingen blijft staan.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, recovering: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[app] render failed:', error);
  }

  private recover = async () => {
    this.setState({ recovering: true });
    try {
      await del('taskgram-query-cache');
      if ('caches' in window) {
        for (const key of await caches.keys()) await caches.delete(key);
      }
      const registrations = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
      await Promise.all(registrations.map((r) => r.unregister()));
    } finally {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <h1 className="text-lg font-semibold">{APP_NAME}</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{t('recover.message')}</p>
          <div className="mt-5 flex flex-col gap-2">
            <button type="button" className="btn btn-primary" disabled={this.state.recovering} onClick={this.recover}>
              {this.state.recovering ? t('recover.busy') : t('recover.action')}
            </button>
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              {t('recover.reload')}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
