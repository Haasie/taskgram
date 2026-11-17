import { hasPendingUpdate, markUpdateAvailable } from './updateStore';

const RELOAD_GUARD_KEY = 'taskgram-reloaded-at';

/** Minimaal tussen twee zoekacties naar een nieuwe service worker (bij terugkeren naar de app). */
export const UPDATE_CHECK_MIN_GAP_MS = 5 * 60_000;
/** Interval voor zoeken zolang de pagina zichtbaar blijft. */
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60_000;

/** Voorkomt een herlaadlus: hooguit één automatische herlaadpoging per minuut. */
export function shouldAutoReload(lastReloadAt: number | null, now: number): boolean {
  return lastReloadAt === null || now - lastReloadAt > 60_000;
}

/** Throttle: mag er weer naar een update gezocht worden? */
export function shouldCheckForUpdate(lastCheckAt: number | null, now: number, minGapMs = UPDATE_CHECK_MIN_GAP_MS): boolean {
  return lastCheckAt === null || now - lastCheckAt >= minGapMs;
}

type UpdatableRegistration = { update(): Promise<unknown> };

/** Zoekt (gethrottled) naar een nieuwe service worker. Netwerkfouten worden stil genegeerd. */
export function createUpdateChecker(opts: {
  getRegistration: () => Promise<UpdatableRegistration | undefined>;
  now?: () => number;
  minGapMs?: number;
}) {
  const now = opts.now ?? Date.now;
  let last: number | null = null;
  return async function check(): Promise<boolean> {
    const t = now();
    if (!shouldCheckForUpdate(last, t, opts.minGapMs)) return false;
    last = t;
    try {
      const reg = await opts.getRegistration();
      if (!reg) return false;
      await reg.update();
      return true;
    } catch {
      return false; // offline of tijdelijk onbereikbaar: volgende keer weer
    }
  };
}

function reloadOnce() {
  const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY)) || null;
  if (!shouldAutoReload(last, Date.now())) return false;
  sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  window.location.reload();
  return true;
}

/** Herladen op verzoek van de gebruiker: de lus-guard geldt hier niet. */
export function reloadNow() {
  sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  window.location.reload();
}

/**
 * Houdt de pagina gelijk met de service worker:
 * - Zoekt actief naar updates: bij terugkeren naar de app (hooguit 1x per 5 min) en elke 30 min
 *   zolang de pagina zichtbaar is. Een PWA die vanuit de achtergrond hervat navigeert niet, dus
 *   de browser zoekt zelf zelden.
 * - Neemt een nieuwe service worker de pagina over terwijl er al een oude actief was, dan
 *   herladen we direct als de app op de achtergrond staat, en anders tonen we een blijvend
 *   balkje en herladen we zodra de gebruiker wegschakelt. Zo gaat geen invoer verloren.
 * - Kan een (toekomstig) los gebundeld onderdeel niet laden, dan één keer herladen.
 */
export function installUpdateHandling() {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadOnce()) event.preventDefault();
  });

  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  const hadController = Boolean(sw.controller);

  const check = createUpdateChecker({ getRegistration: () => sw.getRegistration() });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
    else if (hasPendingUpdate()) reloadOnce();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void check();
  }, UPDATE_CHECK_INTERVAL_MS);

  sw.addEventListener('controllerchange', () => {
    // Eerste installatie: deze pagina draait al de nieuwste code.
    if (!hadController) return;
    if (document.visibilityState === 'hidden') {
      reloadOnce();
      return;
    }
    markUpdateAvailable();
  });
}
