import type { PushSender } from './sender.js';
import type { PushStore } from './store.js';

export const FOCUS_MAX_MS = 4 * 60 * 60_000;

export type FocusAlarm = { endpoint: string; endsAt: number; title: string; lang: 'nl' | 'en' };

/**
 * Eenmalige push als een focustimer afloopt, naar het apparaat dat hem startte. Een vergrendelde
 * telefoon pauzeert JavaScript, dus het apparaat kan zichzelf niet waarschuwen.
 *
 * In het geheugen: na een herstart van de server is een lopend alarm weg (de timer in de app loopt
 * gewoon door). Hoogstens één alarm per apparaat; een nieuw alarm vervangt het oude.
 */
export function createFocusAlarms(deps: {
  store: PushStore;
  sender: PushSender;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}) {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const timers = new Map<string, unknown>();

  async function fire(alarm: FocusAlarm) {
    timers.delete(alarm.endpoint);
    const sub = deps.store.getState().subscriptions.find((s) => s.endpoint === alarm.endpoint);
    if (!sub) return;
    const en = alarm.lang === 'en';
    const res = await deps.sender.send(sub, {
      title: en ? "Time's up" : 'Tijd is om',
      body: alarm.title,
      url: '/#/today',
      tag: 'focus'
    });
    if (res === 'gone') deps.store.removeSubscription(alarm.endpoint);
  }

  return {
    /** `false` als het apparaat geen push-abonnement heeft of het tijdstip niet klopt. */
    schedule(alarm: FocusAlarm): boolean {
      const delay = alarm.endsAt - now();
      if (delay <= 0 || delay > FOCUS_MAX_MS) return false;
      if (!deps.store.getState().subscriptions.some((s) => s.endpoint === alarm.endpoint)) return false;
      this.cancel(alarm.endpoint);
      timers.set(
        alarm.endpoint,
        setTimer(() => void fire(alarm).catch((err) => console.error('[focus] push failed:', err?.message ?? err)), delay)
      );
      return true;
    },
    cancel(endpoint: string): void {
      const h = timers.get(endpoint);
      if (h !== undefined) clearTimer(h);
      timers.delete(endpoint);
    },
    size: () => timers.size
  };
}

export type FocusAlarms = ReturnType<typeof createFocusAlarms>;
