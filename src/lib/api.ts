import type { LinkedEntity, Project, SearchHit, Task, TaskMetadata, TaskStatus, Visibility } from '../../shared/types.js';

export type AuthInfo = { mode: 'password' | 'proxy' | 'oidc' | 'dev'; user: string | null; loginUrl: string | null };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      'x-requested-with': 'taskgram',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (res.redirected) {
    throw new ApiError(401, 'AUTH', 'Sessie verlopen');
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new ApiError(401, 'AUTH', 'Sessie verlopen');
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, payload?.error?.code ?? 'ERROR', payload?.error?.message ?? res.statusText);
  }
  return payload as T;
}

export type TaskPatch = {
  content?: string;
  status?: TaskStatus;
  tags?: string[];
  visibility?: Visibility;
  metadata?: Partial<TaskMetadata>;
};

export type CreateTaskInput = TaskPatch & { content: string };

export const api = {
  me: () => request<{ user: string }>('GET', '/me'),
  authConfig: () => request<AuthInfo>('GET', '/auth/config'),
  login: (username: string, password: string) => request<{ user: string }>('POST', '/auth/login', { username, password }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout', {}),
  tasks: () => request<{ items: Task[] }>('GET', '/tasks').then((r) => r.items),
  getTask: (id: string) => request<{ task: Task }>('GET', `/tasks/${id}`).then((r) => r.task),
  logbook: (offset: number) => request<{ items: Task[]; total: number }>('GET', `/logbook?offset=${offset}`),
  createTask: (body: CreateTaskInput) =>
    request<{ task: Task }>('POST', '/tasks', body).then((r) => r.task),
  updateTask: (id: string, version: number, patch: TaskPatch) =>
    request<{ task: Task }>('PATCH', `/tasks/${id}`, { version, ...patch }).then((r) => r.task),
  completeTask: (id: string, version: number, completed_on?: string) =>
    request<{ task: Task; next: Task | null; warning?: string }>('POST', `/tasks/${id}/complete`, {
      version,
      ...(completed_on ? { completed_on } : {})
    }),
  reopenTask: (id: string, version: number) =>
    request<{ task: Task; removedNextId: string | null }>('POST', `/tasks/${id}/reopen`, { version }),
  deleteTask: (id: string, version: number) => request<unknown>('DELETE', `/tasks/${id}?version=${version}`),
  links: (id: string) => request<{ links: LinkedEntity[] }>('GET', `/tasks/${id}/links`).then((r) => r.links),
  addLink: (id: string, targetId: string) => request<unknown>('POST', `/tasks/${id}/links`, { target_id: targetId }),
  removeLink: (id: string, edgeId: string) => request<unknown>('DELETE', `/tasks/${id}/links/${edgeId}`),
  search: (query: string) => request<{ hits: SearchHit[] }>('POST', '/search', { query }).then((r) => r.hits),
  projects: () => request<{ items: Project[] }>('GET', '/projects').then((r) => r.items),
  createProject: (content: string, visibility: Visibility) =>
    request<{ project: Project }>('POST', '/projects', { content, visibility }).then((r) => r.project),
  updateProject: (id: string, version: number, patch: { content?: string; status?: 'active' | 'done' | 'archived' }) =>
    request<{ project: Project }>('PATCH', `/projects/${id}`, { version, ...patch }).then((r) => r.project),
  pushConfig: () => request<{ enabled: boolean; publicKey: string | null; settings: { digestEnabled: boolean; digestTime: string } }>('GET', '/push/config'),
  subscribePush: (sub: { endpoint: string; keys: { p256dh: string; auth: string }; label?: string | null }) =>
    request<{ id: string }>('POST', '/push/subscriptions', sub),
  unsubscribePush: (endpoint: string) => request<{ ok: true }>('DELETE', '/push/subscriptions', { endpoint }),
  savePushSettings: (settings: { digestEnabled?: boolean; digestTime?: string; language?: 'nl' | 'en' }) =>
    request<{ settings: { digestEnabled: boolean; digestTime: string; language?: 'nl' | 'en' } }>('PUT', '/push/settings', settings),
  testPush: (endpoint: string) => request<{ ok: true }>('POST', '/push/test', { endpoint })
};
