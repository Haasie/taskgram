import type { Config } from './config.js';

export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type RawEntity = {
  id: string;
  type: string;
  content: string | null;
  visibility: 'personal' | 'work' | 'shared';
  status: string | null;
  version: number;
  tags: string[];
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type RawEdge = {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
};

type Query = Record<string, string | number | boolean | undefined>;

export function createPostgramClient(config: Config) {
  async function request<T>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
    const url = new URL(config.pgmApiUrl + path);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${config.pgmApiKey}`,
          ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {})
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(15_000)
      });
    } catch {
      throw new UpstreamError(502, 'UPSTREAM_UNAVAILABLE', 'Postgram is unavailable');
    }

    const payload = (await res.json().catch(() => null)) as
      | (T & { error?: { code?: string; message?: string } })
      | null;

    if (!res.ok) {
      const status = [400, 404, 409, 422].includes(res.status) ? res.status : 502;
      throw new UpstreamError(
        status,
        payload?.error?.code ?? 'UPSTREAM_ERROR',
        payload?.error?.message ?? `Postgram responded with ${res.status}`
      );
    }
    return payload as T;
  }

  async function listAll(path: string, query: Query) {
    const pageSize = 200;
    const items: RawEntity[] = [];
    for (let offset = 0; offset < 5_000; offset += pageSize) {
      const page = await request<{ items: RawEntity[]; total: number }>('GET', path, {
        query: { ...query, limit: pageSize, offset }
      });
      items.push(...page.items);
      if (items.length >= page.total || page.items.length < pageSize) break;
    }
    return items;
  }

  return {
    listTasks: (status: string) => listAll('/api/tasks', { status }),
    listTasksPage: (status: string, limit: number, offset: number) =>
      request<{ items: RawEntity[]; total: number }>('GET', '/api/tasks', { query: { status, limit, offset } }),
    listProjects: () => listAll('/api/entities', { type: 'project' }),
    getEntity: (id: string) =>
      request<{ entity: RawEntity }>('GET', `/api/entities/${encodeURIComponent(id)}`).then((r) => r.entity),
    createTask: (body: unknown) => request<{ entity: RawEntity }>('POST', '/api/tasks', { body }).then((r) => r.entity),
    updateTask: (id: string, body: unknown) =>
      request<{ entity: RawEntity }>('PATCH', `/api/tasks/${encodeURIComponent(id)}`, { body }).then((r) => r.entity),
    completeTask: (id: string, version: number) =>
      request<{ entity: RawEntity }>('POST', `/api/tasks/${encodeURIComponent(id)}/complete`, {
        body: { version }
      }).then((r) => r.entity),
    createEntity: (body: unknown) =>
      request<{ entity: RawEntity }>('POST', '/api/entities', { body }).then((r) => r.entity),
    updateEntity: (id: string, body: unknown) =>
      request<{ entity: RawEntity }>('PATCH', `/api/entities/${encodeURIComponent(id)}`, { body }).then((r) => r.entity),
    deleteEntity: (id: string) => request<unknown>('DELETE', `/api/entities/${encodeURIComponent(id)}`),
    listEdges: (id: string) =>
      request<{ edges: RawEdge[] }>('GET', `/api/entities/${encodeURIComponent(id)}/edges`, {
        query: { direction: 'both' }
      }).then((r) => r.edges),
    createEdge: (sourceId: string, targetId: string, relation: string) =>
      request<{ edge: RawEdge }>('POST', '/api/edges', {
        body: { source_id: sourceId, target_id: targetId, relation }
      }).then((r) => r.edge),
    deleteEdge: (id: string) => request<unknown>('DELETE', `/api/edges/${encodeURIComponent(id)}`),
    search: (query: string) =>
      request<{ results: { entity: RawEntity; score: number }[] }>('POST', '/api/search', {
        body: { query, limit: 12 }
      }).then((r) => r.results)
  };
}

export type PostgramClient = ReturnType<typeof createPostgramClient>;
