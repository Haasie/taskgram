import { useSyncExternalStore } from 'react';

/**
 * Toestand van de "nieuwe versie"-balk. `available` telt hoeveel nieuwe versies er sinds het
 * laden zijn binnengekomen, `dismissed` tot welke versie de gebruiker "Later" koos. Het balkje
 * toont zolang er een nieuwere versie is dan de weggeklikte.
 */
export type UpdateState = { available: number; dismissed: number };

export const initialUpdateState: UpdateState = { available: 0, dismissed: 0 };

export const withNewVersion = (s: UpdateState): UpdateState => ({ ...s, available: s.available + 1 });
export const withDismissed = (s: UpdateState): UpdateState => ({ ...s, dismissed: s.available });
export const isBarVisible = (s: UpdateState): boolean => s.available > s.dismissed;

let state = initialUpdateState;
const listeners = new Set<() => void>();
const set = (next: UpdateState) => {
  state = next;
  listeners.forEach((l) => l());
};

export const markUpdateAvailable = () => set(withNewVersion(state));
export const dismissUpdateBar = () => set(withDismissed(state));
export const hasPendingUpdate = () => state.available > 0;

export function useUpdateBarVisible(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => isBarVisible(state)
  );
}
