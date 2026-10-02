import { toISODate } from '../../shared/dates.js';
import type { Task, TaskMetadata, TaskStatus } from '../../shared/types.js';
import { ApiError, type CreateTaskInput, type TaskPatch } from './api';
import { splitContent } from './task';
import { t, translateApiError } from '../i18n/index.js';

export type PatchField = 'content' | 'status' | 'tags' | 'visibility' | `metadata.${string}`;

export type OutboxOp =
  | { id: string; kind: 'create'; taskId: string; input: CreateTaskInput; createdAt: string }
  | { id: string; kind: 'update'; taskId: string; patch: TaskPatch; base: Partial<Record<PatchField, unknown>>; createdAt: string }
  | { id: string; kind: 'complete' | 'reopen' | 'delete'; taskId: string; createdAt: string };

export type Conflict = {
  id: string;
  kind: 'update' | 'complete' | 'reopen' | 'delete';
  taskId: string;
  title: string;
  patch: TaskPatch | null;
  server: Task;
  at: string;
};

export type SyncStatus = {
  online: boolean;
  syncing: boolean;
  pending: number;
  conflicts: Conflict[];
  authRequired: boolean;
};

export type OutboxStorage = {
  get: <T>(key: string) => Promise<T | undefined>;
  set: <T>(key: string, value: T) => Promise<void>;
};

export type OutboxApi = {
  tasks: () => Promise<Task[]>;
  getTask: (id: string) => Promise<Task>;
  createTask: (body: CreateTaskInput) => Promise<Task>;
  updateTask: (id: string, version: number, patch: TaskPatch) => Promise<Task>;
  completeTask: (id: string, version: number, completed_on?: string) => Promise<{ task: Task; next: Task | null; warning?: string }>;
  reopenTask: (id: string, version: number) => Promise<{ task: Task; removedNextId: string | null }>;
  deleteTask: (id: string, version: number) => Promise<unknown>;
};

export type OutboxEngineOptions = {
  api: OutboxApi;
  storage: OutboxStorage;
  now?: () => Date;
  getTaskVersion?: (taskId: string) => number | undefined;
  onTaskSaved?: (task: Task, next?: Task | null) => void;
  onTaskRemoved?: (taskId: string) => void;
  onIdRewrite?: (oldId: string, newId: string) => void;
  onConflict?: (conflict: Conflict) => void;
  onStatus?: (status: SyncStatus) => void;
  toast?: (message: string) => void;
  autoStart?: boolean;
};

export const OUTBOX_KEY = 'outbox:v1';
export const CONFLICTS_KEY = 'conflicts:v1';

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
    if (!deepEqual(objA[key], objB[key])) return false;
  }
  return true;
}

export function getField(task: Task, field: PatchField): unknown {
  if (field === 'content') return task.content;
  if (field === 'status') return task.status;
  if (field === 'tags') return task.tags;
  if (field === 'visibility') return task.visibility;
  if (field.startsWith('metadata.')) {
    const key = field.slice(9);
    const val = task.metadata?.[key];
    return val !== undefined ? val : null;
  }
  return undefined;
}

export function computeBase(task: Task, patch: TaskPatch): Partial<Record<PatchField, unknown>> {
  const base: Partial<Record<PatchField, unknown>> = {};
  if (patch.content !== undefined) {
    base.content = task.content;
  }
  if (patch.status !== undefined) {
    base.status = task.status;
  }
  if (patch.tags !== undefined) {
    base.tags = structuredClone(task.tags);
  }
  if (patch.visibility !== undefined) {
    base.visibility = task.visibility;
  }
  if (patch.metadata !== undefined) {
    for (const key of Object.keys(patch.metadata)) {
      const field = `metadata.${key}` as PatchField;
      const val = task.metadata?.[key];
      base[field] = val !== undefined ? (typeof val === 'object' && val !== null ? structuredClone(val) : val) : null;
    }
  }
  return base;
}

export function applyOutbox(tasks: Task[], ops: OutboxOp[]): Task[] {
  let result = [...tasks];
  for (const op of ops) {
    if (op.kind === 'create') {
      const existing = result.find((t) => t.id === op.taskId);
      if (!existing) {
        const newTask: Task = {
          id: op.taskId,
          version: 0,
          content: op.input.content,
          status: op.input.status ?? 'inbox',
          visibility: op.input.visibility ?? 'personal',
          tags: op.input.tags ?? [],
          metadata: (op.input.metadata as TaskMetadata) ?? {},
          createdAt: op.createdAt,
          updatedAt: op.createdAt
        };
        result.push(newTask);
      }
    } else if (op.kind === 'update') {
      result = result.map((t) => {
        if (t.id !== op.taskId) return t;
        return {
          ...t,
          ...(op.patch.content !== undefined ? { content: op.patch.content } : {}),
          ...(op.patch.status !== undefined ? { status: op.patch.status } : {}),
          ...(op.patch.tags !== undefined ? { tags: op.patch.tags } : {}),
          ...(op.patch.visibility !== undefined ? { visibility: op.patch.visibility } : {}),
          metadata: { ...t.metadata, ...(op.patch.metadata ?? {}) },
          updatedAt: op.createdAt
        };
      });
    } else if (op.kind === 'complete') {
      result = result.map((t) => {
        if (t.id !== op.taskId) return t;
        return {
          ...t,
          status: 'done' as TaskStatus,
          metadata: { ...t.metadata, completed_at: op.createdAt },
          updatedAt: op.createdAt
        };
      });
    } else if (op.kind === 'reopen') {
      result = result.map((t) => {
        if (t.id !== op.taskId) return t;
        const start = t.metadata?.start_date;
        const opDate = toISODate(new Date(op.createdAt));
        const nextStatus: TaskStatus = start && start > opDate ? 'scheduled' : 'next';
        return {
          ...t,
          status: nextStatus,
          metadata: { ...t.metadata, completed_at: null, recurrence_next_id: null },
          updatedAt: op.createdAt
        };
      });
    } else if (op.kind === 'delete') {
      result = result.filter((t) => t.id !== op.taskId);
    }
  }
  return result;
}

export function rewriteTaskId(ops: OutboxOp[], oldId: string, newId: string): OutboxOp[] {
  return ops.map((op) => (op.taskId === oldId ? { ...op, taskId: newId } : op));
}

export function rebaseDecision(op: OutboxOp, serverTask: Task): 'retry' | 'conflict' {
  if (op.kind === 'delete') return 'conflict';
  if (op.kind === 'create') return 'retry';
  if (op.kind === 'complete' || op.kind === 'reopen') return 'retry';
  if (op.kind === 'update') {
    if (!op.base) return 'conflict';
    for (const [field, baseVal] of Object.entries(op.base)) {
      const serverVal = getField(serverTask, field as PatchField);
      if (!deepEqual(baseVal, serverVal)) {
        return 'conflict';
      }
    }
    return 'retry';
  }
  return 'conflict';
}

export type OutboxEngine = {
  enqueue: (op: OutboxOp) => Promise<void>;
  flush: () => Promise<void>;
  pending: () => OutboxOp[];
  conflicts: () => Conflict[];
  getStatus: () => SyncStatus;
  resolveConflict: (conflictId: string, action: 'apply' | 'discard') => Promise<void>;
  subscribe: (listener: () => void) => () => void;
  /** Na opnieuw inloggen: hervat de (gepauzeerde) synchronisatie. */
  resumeAfterLogin: () => Promise<void>;
  destroy: () => void;
};

export function createOutboxEngine(options: OutboxEngineOptions): OutboxEngine {
  const { api, storage } = options;
  let ops: OutboxOp[] = [];
  let conflicts: Conflict[] = [];
  let online = typeof navigator !== 'undefined' ? navigator.onLine : true;
  let syncing = false;
  let authRequired = false;
  let retryAttempt = 0;
  let retryTimeout: any = null;
  let currentFlight: Promise<void> | null = null;
  const subscribers = new Set<() => void>();
  const taskVersions = new Map<string, number>();

  let initialized = false;
  let initPromise: Promise<void> | null = null;

  async function ensureInit(): Promise<void> {
    if (initialized) return;
    if (!initPromise) {
      initPromise = (async () => {
        const [storedOps, storedConflicts] = await Promise.all([
          storage.get<OutboxOp[]>(OUTBOX_KEY),
          storage.get<Conflict[]>(CONFLICTS_KEY)
        ]);
        if (storedOps && Array.isArray(storedOps)) {
          ops = [...storedOps, ...ops];
        }
        if (storedConflicts && Array.isArray(storedConflicts)) {
          conflicts = [...storedConflicts, ...conflicts];
        }
        initialized = true;
        notify();
      })();
    }
    await initPromise;
  }

  void ensureInit();

  function getVersion(taskId: string): number {
    return options.getTaskVersion?.(taskId) ?? taskVersions.get(taskId) ?? 1;
  }

  let cachedStatus: SyncStatus = {
    online,
    syncing,
    pending: ops.length,
    conflicts: [...conflicts],
    authRequired
  };

  function updateStatus(): void {
    cachedStatus = {
      online,
      syncing,
      pending: ops.length,
      conflicts: [...conflicts],
      authRequired
    };
  }

  function getStatus(): SyncStatus {
    return cachedStatus;
  }

  function notify() {
    updateStatus();
    options.onStatus?.(cachedStatus);
    for (const sub of subscribers) {
      sub();
    }
  }

  function scheduleRetry() {
    if (retryTimeout) return;
    const delay = Math.min(2000 * Math.pow(2, retryAttempt), 60000);
    retryAttempt++;
    retryTimeout = setTimeout(() => {
      retryTimeout = null;
      void flush();
    }, delay);
  }

  function resetRetry() {
    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }
    retryAttempt = 0;
  }

  async function recordConflict(
    kind: Conflict['kind'],
    taskId: string,
    patch: TaskPatch | null,
    server: Task
  ): Promise<void> {
    const at = (options.now ? options.now() : new Date()).toISOString();
    const title = splitContent(server.content).title || server.content || 'Taak';
    const conflict: Conflict = {
      id: crypto.randomUUID(),
      kind,
      taskId,
      title,
      patch,
      server,
      at
    };
    conflicts.push(conflict);
    await storage.set(CONFLICTS_KEY, conflicts);
    options.onTaskSaved?.(server);
    options.onConflict?.(conflict);
    options.toast?.(t('toast.conflict', { title }));
  }

  async function flush(): Promise<void> {
    await ensureInit();
    if (currentFlight) return currentFlight;
    if (authRequired) return;
    if (ops.length === 0) return;

    currentFlight = (async () => {
      syncing = true;
      notify();

      try {
        while (ops.length > 0 && !authRequired) {
          const op = ops[0];
          if (!op) break;
          try {
            if (op.kind === 'create') {
              const serverTask = await api.createTask(op.input);
              taskVersions.set(serverTask.id, serverTask.version);
              options.onIdRewrite?.(op.taskId, serverTask.id);
              ops = rewriteTaskId(ops, op.taskId, serverTask.id);
              options.onTaskSaved?.(serverTask);
              ops.shift();
              await storage.set(OUTBOX_KEY, ops);
              online = true;
              resetRetry();
              notify();
            } else if (op.kind === 'update') {
              const version = getVersion(op.taskId);
              const serverTask = await api.updateTask(op.taskId, version, op.patch);
              taskVersions.set(serverTask.id, serverTask.version);
              options.onTaskSaved?.(serverTask);
              ops.shift();
              await storage.set(OUTBOX_KEY, ops);
              online = true;
              resetRetry();
              notify();
            } else if (op.kind === 'complete') {
              const version = getVersion(op.taskId);
              const completedOn = toISODate(new Date(op.createdAt));
              const res = await api.completeTask(op.taskId, version, completedOn);
              taskVersions.set(res.task.id, res.task.version);
              if (res.next) {
                taskVersions.set(res.next.id, res.next.version);
              }
              options.onTaskSaved?.(res.task, res.next);
              if (res.warning) {
                options.toast?.(res.warning);
              }
              ops.shift();
              await storage.set(OUTBOX_KEY, ops);
              online = true;
              resetRetry();
              notify();
            } else if (op.kind === 'reopen') {
              const version = getVersion(op.taskId);
              const res = await api.reopenTask(op.taskId, version);
              taskVersions.set(res.task.id, res.task.version);
              options.onTaskSaved?.(res.task);
              if (res.removedNextId) {
                options.onTaskRemoved?.(res.removedNextId);
              }
              ops.shift();
              await storage.set(OUTBOX_KEY, ops);
              online = true;
              resetRetry();
              notify();
            } else if (op.kind === 'delete') {
              const version = getVersion(op.taskId);
              await api.deleteTask(op.taskId, version);
              options.onTaskRemoved?.(op.taskId);
              ops.shift();
              await storage.set(OUTBOX_KEY, ops);
              online = true;
              resetRetry();
              notify();
            }
          } catch (err: unknown) {
            const isNetwork =
              err instanceof TypeError ||
              (err instanceof Error && (err.name === 'TypeError' || err.message.toLowerCase().includes('failed to fetch')));

            if (isNetwork) {
              online = false;
              scheduleRetry();
              break;
            }

            if (err instanceof ApiError && (err.status === 401 || err.code === 'AUTH')) {
              authRequired = true;
              break;
            }

            if (err instanceof ApiError && err.status === 404) {
              options.onTaskRemoved?.(op.taskId);
              options.toast?.(t('toast.taskNotFound'));
              ops.shift();
              await storage.set(OUTBOX_KEY, ops);
              notify();
              continue;
            }

            if (err instanceof ApiError && err.status === 409) {
              if (op.kind === 'update') {
                let serverTask: Task;
                try {
                  serverTask = await api.getTask(op.taskId);
                } catch (e) {
                  if (e instanceof ApiError && e.status === 404) {
                    options.onTaskRemoved?.(op.taskId);
                    options.toast?.(t('toast.taskNotFound'));
                    ops.shift();
                    await storage.set(OUTBOX_KEY, ops);
                    notify();
                    continue;
                  }
                  throw e;
                }
                const decision = rebaseDecision(op, serverTask);
                if (decision === 'retry') {
                  try {
                    const saved = await api.updateTask(op.taskId, serverTask.version, op.patch);
                    taskVersions.set(saved.id, saved.version);
                    options.onTaskSaved?.(saved);
                    ops.shift();
                    await storage.set(OUTBOX_KEY, ops);
                    online = true;
                    resetRetry();
                    notify();
                    continue;
                  } catch (retryErr) {
                    if (retryErr instanceof ApiError && retryErr.status === 409) {
                      let latestServer = serverTask;
                      try {
                        latestServer = await api.getTask(op.taskId);
                      } catch {}
                      await recordConflict('update', op.taskId, op.patch, latestServer);
                      ops.shift();
                      await storage.set(OUTBOX_KEY, ops);
                      notify();
                      continue;
                    }
                    throw retryErr;
                  }
                } else {
                  await recordConflict('update', op.taskId, op.patch, serverTask);
                  ops.shift();
                  await storage.set(OUTBOX_KEY, ops);
                  notify();
                  continue;
                }
              } else if (op.kind === 'complete' || op.kind === 'reopen') {
                let serverTask: Task;
                try {
                  serverTask = await api.getTask(op.taskId);
                } catch (e) {
                  if (e instanceof ApiError && e.status === 404) {
                    options.onTaskRemoved?.(op.taskId);
                    options.toast?.('Taak bestaat niet meer in Postgram');
                    ops.shift();
                    await storage.set(OUTBOX_KEY, ops);
                    notify();
                    continue;
                  }
                  throw e;
                }

                try {
                  if (op.kind === 'complete') {
                    const completedOn = toISODate(new Date(op.createdAt));
                    const res = await api.completeTask(op.taskId, serverTask.version, completedOn);
                    taskVersions.set(res.task.id, res.task.version);
                    if (res.next) taskVersions.set(res.next.id, res.next.version);
                    options.onTaskSaved?.(res.task, res.next);
                    if (res.warning) options.toast?.(res.warning);
                  } else {
                    const res = await api.reopenTask(op.taskId, serverTask.version);
                    taskVersions.set(res.task.id, res.task.version);
                    options.onTaskSaved?.(res.task);
                    if (res.removedNextId) options.onTaskRemoved?.(res.removedNextId);
                  }
                  ops.shift();
                  await storage.set(OUTBOX_KEY, ops);
                  online = true;
                  resetRetry();
                  notify();
                  continue;
                } catch (retryErr) {
                  if (retryErr instanceof ApiError && retryErr.status === 409) {
                    let latestServer = serverTask;
                    try {
                      latestServer = await api.getTask(op.taskId);
                    } catch {}
                    await recordConflict(op.kind, op.taskId, null, latestServer);
                    ops.shift();
                    await storage.set(OUTBOX_KEY, ops);
                    notify();
                    continue;
                  }
                  throw retryErr;
                }
              } else if (op.kind === 'delete') {
                let serverTask: Task;
                try {
                  serverTask = await api.getTask(op.taskId);
                } catch (e) {
                  if (e instanceof ApiError && e.status === 404) {
                    options.onTaskRemoved?.(op.taskId);
                    ops.shift();
                    await storage.set(OUTBOX_KEY, ops);
                    notify();
                    continue;
                  }
                  throw e;
                }
                await recordConflict('delete', op.taskId, null, serverTask);
                ops.shift();
                await storage.set(OUTBOX_KEY, ops);
                notify();
                continue;
              }
            }

            if (err instanceof ApiError && err.status >= 500) {
              scheduleRetry();
              break;
            }

            if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
              options.toast?.(translateApiError(err));
              ops.shift();
              await storage.set(OUTBOX_KEY, ops);
              notify();
              continue;
            }

            scheduleRetry();
            break;
          }
        }
      } finally {
        syncing = false;
        currentFlight = null;
        notify();
      }
    })();

    return currentFlight;
  }

  async function enqueue(op: OutboxOp): Promise<void> {
    await ensureInit();
    ops.push(op);
    await storage.set(OUTBOX_KEY, ops);
    notify();
    void flush();
  }

  async function resolveConflict(conflictId: string, action: 'apply' | 'discard'): Promise<void> {
    await ensureInit();
    const idx = conflicts.findIndex((c) => c.id === conflictId);
    if (idx === -1) return;
    const conflict = conflicts[idx];
    if (!conflict) return;
    conflicts.splice(idx, 1);
    await storage.set(CONFLICTS_KEY, conflicts);

    if (action === 'apply') {
      const at = (options.now ? options.now() : new Date()).toISOString();
      if (conflict.kind === 'update' && conflict.patch) {
        const base = computeBase(conflict.server, conflict.patch);
        const op: OutboxOp = {
          id: crypto.randomUUID(),
          kind: 'update',
          taskId: conflict.taskId,
          patch: conflict.patch,
          base,
          createdAt: at
        };
        await enqueue(op);
      } else if (conflict.kind === 'complete' || conflict.kind === 'reopen' || conflict.kind === 'delete') {
        const op: OutboxOp = {
          id: crypto.randomUUID(),
          kind: conflict.kind,
          taskId: conflict.taskId,
          createdAt: at
        };
        await enqueue(op);
      }
    } else {
      notify();
    }
  }

  function subscribe(listener: () => void): () => void {
    subscribers.add(listener);
    return () => {
      subscribers.delete(listener);
    };
  }

  const onOnline = () => {
    online = true;
    resetRetry();
    notify();
    void flush();
  };

  const onFocus = () => {
    if (online && ops.length > 0 && !syncing) {
      void flush();
    }
  };

  const onVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible' && online && ops.length > 0 && !syncing) {
      void flush();
    }
  };

  if (options.autoStart !== false) {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline);
      window.addEventListener('focus', onFocus);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
  }

  function resumeAfterLogin(): Promise<void> {
    authRequired = false;
    notify();
    return flush();
  }

  function destroy() {
    resetRetry();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onFocus);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    subscribers.clear();
  }

  return {
    enqueue,
    flush,
    pending: () => [...ops],
    conflicts: () => [...conflicts],
    getStatus,
    resolveConflict,
    subscribe,
    resumeAfterLogin,
    destroy
  };
}
