import { useSyncExternalStore } from 'react';

export type Toast = { id: number; message: string; action?: { label: string; run: () => void } };

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showToast(message: string, action?: Toast['action'], ms = 4000) {
  const toast = { id: nextId++, message, action };
  toasts = [...toasts.slice(-2), toast];
  emit();
  setTimeout(() => dismissToast(toast.id), ms);
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts
  );
}
