import { QueryClient, useQuery } from '@tanstack/react-query';
import { get, set } from 'idb-keyval';
import { toISODate } from '../../shared/dates.js';
import { startDate } from '../../shared/taskFields.js';
import type { Project, Task, TaskMetadata } from '../../shared/types.js';
import { api, ApiError, type CreateTaskInput, type TaskPatch } from './api';
import {
  applyOutbox,
  computeBase,
  createOutboxEngine,
  type OutboxEngine,
  type OutboxOp,
  type OutboxStorage
} from './outbox';
import { enqueue } from './serial';
import { showToast } from './toast';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 }
  }
});

const TASKS = ['tasks'] as const;
const PROJECTS = ['projects'] as const;

const idRewriteListeners = new Set<(oldId: string, newId: string) => void>();
export function onTaskIdRewritten(fn: (oldId: string, newId: string) => void) {
  idRewriteListeners.add(fn);
  return () => {
    idRewriteListeners.delete(fn);
  };
}
function notifyIdRewrite(oldId: string, newId: string) {
  for (const fn of idRewriteListeners) {
    fn(oldId, newId);
  }
}

const getTasks = () => queryClient.getQueryData<Task[]>(TASKS) ?? [];
const setTasks = (fn: (tasks: Task[]) => Task[]) => queryClient.setQueryData<Task[]>(TASKS, (old) => fn(old ?? []));
const replaceTask = (task: Task) =>
  setTasks((tasks) => (tasks.some((t) => t.id === task.id) ? tasks.map((t) => (t.id === task.id ? task : t)) : [task, ...tasks]));

function findTask(id: string): Task | undefined {
  const fromTasks = getTasks().find((t) => t.id === id);
  if (fromTasks) return fromTasks;
  const logbook = queryClient.getQueryData<{ pages: { items: Task[] }[] }>(['logbook']);
  if (logbook) {
    for (const page of logbook.pages) {
      const found = page.items.find((t) => t.id === id);
      if (found) return found;
    }
  }
  return undefined;
}

const memoryFallback = new Map<string, unknown>();
const storage: OutboxStorage = {
  get: async <T>(key: string) => {
    try {
      if (typeof indexedDB === 'undefined') {
        return memoryFallback.get(key) as T | undefined;
      }
      return await get<T>(key);
    } catch {
      return undefined;
    }
  },
  set: async <T>(key: string, value: T) => {
    try {
      if (typeof indexedDB === 'undefined') {
        memoryFallback.set(key, value);
        return;
      }
      await set(key, value);
    } catch {}
  }
};

export const outboxEngine: OutboxEngine = createOutboxEngine({
  api,
  storage,
  getTaskVersion: (id) => findTask(id)?.version,
  onTaskSaved: (task, next) => {
    replaceTask(task);
    if (next) {
      setTasks((tasks) =>
        tasks.some((t) => t.id === next.id) ? tasks.map((t) => (t.id === next.id ? next : t)) : [...tasks, next]
      );
    }
    void queryClient.invalidateQueries({ queryKey: ['logbook'] });
  },
  onTaskRemoved: (taskId) => {
    setTasks((tasks) => tasks.filter((t) => t.id !== taskId));
    queryClient.setQueryData<{ pages: { items: Task[] }[] }>(['logbook'], (old) =>
      old && { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.filter((t) => t.id !== taskId) })) }
    );
  },
  onIdRewrite: (oldId, newId) => {
    setTasks((tasks) => tasks.map((t) => (t.id === oldId ? { ...t, id: newId } : t)));
    notifyIdRewrite(oldId, newId);
  },
  toast: showToast
});

export const useTasks = () =>
  useQuery({
    queryKey: TASKS,
    queryFn: async () => {
      try {
        const serverTasks = await api.tasks();
        return applyOutbox(serverTasks, outboxEngine.pending());
      } catch (err) {
        const cached = getTasks();
        if (cached && cached.length > 0) {
          return applyOutbox(cached, outboxEngine.pending());
        }
        throw err;
      }
    },
    refetchInterval: 120_000
  });

export const useProjects = () =>
  useQuery({
    queryKey: PROJECTS,
    queryFn: async () => {
      try {
        return await api.projects();
      } catch (err) {
        const cached = queryClient.getQueryData<Project[]>(PROJECTS);
        if (cached && cached.length > 0) {
          return cached;
        }
        throw err;
      }
    }
  });

function applyPatch(task: Task, patch: TaskPatch): Task {
  return {
    ...task,
    ...(patch.content !== undefined ? { content: patch.content } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
    metadata: { ...task.metadata, ...(patch.metadata ?? {}) }
  };
}

export function updateTask(task: Task, patch: TaskPatch): Promise<void> {
  setTasks((tasks) => tasks.map((t) => (t.id === task.id ? applyPatch(t, patch) : t)));
  const base = computeBase(task, patch);
  const op: OutboxOp = {
    id: crypto.randomUUID(),
    kind: 'update',
    taskId: task.id,
    patch,
    base,
    createdAt: new Date().toISOString()
  };
  return outboxEngine.enqueue(op);
}

export function completeTask(task: Task, completedOn?: string): Promise<void> {
  const completed_at = completedOn ? new Date(completedOn).toISOString() : new Date().toISOString();
  setTasks((tasks) =>
    tasks.map((t) => (t.id === task.id ? { ...t, status: 'done', metadata: { ...t.metadata, completed_at } } : t))
  );
  const op: OutboxOp = {
    id: crypto.randomUUID(),
    kind: 'complete',
    taskId: task.id,
    createdAt: completed_at
  };
  return outboxEngine.enqueue(op);
}

export function reopenTask(taskId: string): Promise<void> {
  const task = findTask(taskId);
  if (!task) return Promise.resolve();

  const now = new Date();
  const today = toISODate(now);
  const start = startDate(task);
  const nextStatus = start && start > today ? 'scheduled' : 'next';
  const reopened: Task = {
    ...task,
    status: nextStatus,
    metadata: { ...task.metadata, completed_at: null, recurrence_next_id: null }
  };
  replaceTask(reopened);

  const op: OutboxOp = {
    id: crypto.randomUUID(),
    kind: 'reopen',
    taskId,
    createdAt: now.toISOString()
  };
  return outboxEngine.enqueue(op);
}

export function createTask(input: CreateTaskInput): Task {
  const now = new Date().toISOString();
  const tmpId = 'tmp-' + crypto.randomUUID();
  const task: Task = {
    id: tmpId,
    version: 0,
    content: input.content,
    status: input.status ?? 'inbox',
    tags: input.tags ?? [],
    visibility: input.visibility ?? 'personal',
    metadata: (input.metadata as TaskMetadata) ?? {},
    createdAt: now,
    updatedAt: now
  };
  replaceTask(task);
  const op: OutboxOp = {
    id: crypto.randomUUID(),
    kind: 'create',
    taskId: tmpId,
    input,
    createdAt: now
  };
  void outboxEngine.enqueue(op);
  return task;
}

export function deleteTask(task: Task): Promise<void> {
  setTasks((tasks) => tasks.filter((t) => t.id !== task.id));
  queryClient.setQueryData<{ pages: { items: Task[] }[] }>(['logbook'], (old) =>
    old && { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.filter((t) => t.id !== task.id) })) }
  );
  const op: OutboxOp = {
    id: crypto.randomUUID(),
    kind: 'delete',
    taskId: task.id,
    createdAt: new Date().toISOString()
  };
  return outboxEngine.enqueue(op);
}

export async function createProject(content: string, visibility: Project['visibility']) {
  try {
    const project = await api.createProject(content, visibility);
    queryClient.setQueryData<Project[]>(PROJECTS, (old) => [...(old ?? []), project]);
    return project;
  } catch (err) {
    showToast(`Project aanmaken mislukt: ${err instanceof Error ? err.message : ''}`);
    return null;
  }
}

export function updateProject(projectId: string, patch: { content?: string; status?: 'active' | 'done' | 'archived' }) {
  queryClient.setQueryData<Project[]>(PROJECTS, (old) =>
    (old ?? [])
      .map((p) => (p.id === projectId ? { ...p, ...patch } : p))
      .filter((p) => p.status !== 'archived')
  );
  return enqueue('project:' + projectId, async () => {
    const projects = queryClient.getQueryData<Project[]>(PROJECTS) ?? [];
    const current = projects.find((p) => p.id === projectId);
    const version = current?.version ?? 1;
    try {
      const saved = await api.updateProject(projectId, version, patch);
      queryClient.setQueryData<Project[]>(PROJECTS, (old) => (old ?? []).map((p) => (p.id === saved.id ? saved : p)));
      return saved;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        showToast('Project is elders gewijzigd; opnieuw geladen.');
      } else {
        showToast(`Project opslaan mislukt: ${err instanceof Error ? err.message : ''}`);
      }
      void queryClient.invalidateQueries({ queryKey: PROJECTS });
    }
  });
}
