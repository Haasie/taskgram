import { showToast } from './toast';
import { t } from '../i18n';

const RELOAD_GUARD_KEY = 'taskgram-reloaded-at';

/** Voorkomt een herlaadlus: hooguit één automatische herlaadpoging per minuut. */
export function shouldAutoReload(lastReloadAt: number | null, now: number): boolean {
  return lastReloadAt === null || now - lastReloadAt > 60_000;
}

function reloadOnce() {
  const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY)) || null;
  if (!shouldAutoReload(last, Date.now())) return false;
  sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  window.location.reload();
  return true;
}

/**
 * Houdt de pagina gelijk met de service worker:
 * - Neemt een nieuwe service worker de pagina over terwijl er al een oude actief was, dan
 *   herladen we direct als de app op de achtergrond staat, en anders zodra de gebruiker
 *   wegschakelt (met een melding om het meteen te doen). Zo gaat geen invoer verloren.
 * - Kan een (toekomstig) los gebundeld onderdeel niet laden, dan één keer herladen.
 */
export function installUpdateHandling() {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadOnce()) event.preventDefault();
  });

  if (!('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let pending = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Eerste installatie: deze pagina draait al de nieuwste code.
    if (!hadController || pending) return;
    pending = true;
    if (document.visibilityState === 'hidden') {
      reloadOnce();
      return;
    }
    showToast(t('update.available'), { label: t('update.reload'), run: () => reloadOnce() }, 15_000);
    const onHide = () => {
      if (document.visibilityState === 'hidden') reloadOnce();
    };
    document.addEventListener('visibilitychange', onHide);
  });
}
