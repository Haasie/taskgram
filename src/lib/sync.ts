import { useSyncExternalStore } from 'react';
import type { SyncStatus } from './outbox';
import { outboxEngine } from './queries';

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    outboxEngine.subscribe,
    outboxEngine.getStatus,
    outboxEngine.getStatus
  );
}

export function resolveConflict(conflictId: string, action: 'apply' | 'discard'): Promise<void> {
  return outboxEngine.resolveConflict(conflictId, action);
}

export function retrySync(): Promise<void> {
  return outboxEngine.flush();
}

export function resumeAfterLogin(): Promise<void> {
  return outboxEngine.resumeAfterLogin();
}
