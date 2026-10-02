import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import type { Config } from './config.js';
import { UpstreamError, type PostgramClient, type RawEdge, type RawEntity } from './postgram.js';

const SECRET = 'x'.repeat(40);
const config: Config = {
  pgmApiUrl: 'https://postgram.example',
  pgmApiKey: 'k',
  auth: {
    mode: 'proxy',
    userHeader: 'x-cosmos-user',
    secretHeader: 'x-proxy-secret',
    secret: SECRET,
    allowedUsers: new Set(['alice']),
    loginPath: '/api/login'
  },
  port: 0,
  staticDir: './does-not-exist',
  appTimezone: 'Europe/Amsterdam'
};

const authedHeaders = {
  'x-proxy-secret': SECRET,
  'x-cosmos-user': 'alice',
  'x-requested-with': 'taskgram',
  'content-type': 'application/json'
};

class FakePostgramClient {
  tasks = new Map<string, RawEntity>();
  edges: RawEdge[] = [];

  async getEntity(id: string): Promise<RawEntity> {
    const entity = this.tasks.get(id);
    if (!entity) throw new UpstreamError(404, 'NOT_FOUND', `Entity ${id} not found`);
    return JSON.parse(JSON.stringify(entity));
  }

  async createTask(body: any): Promise<RawEntity> {
    const id = randomUUID();
    const entity: RawEntity = {
      id,
      type: 'task',
      content: body.content ?? '',
      visibility: body.visibility ?? 'personal',
      status: body.status ?? 'inbox',
      version: 1,
      tags: body.tags ?? [],
      metadata: body.metadata ? JSON.parse(JSON.stringify(body.metadata)) : {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this.tasks.set(id, entity);
    return JSON.parse(JSON.stringify(entity));
  }

  async updateTask(id: string, body: any): Promise<RawEntity> {
    const entity = this.tasks.get(id);
    if (!entity) throw new UpstreamError(404, 'NOT_FOUND', `Entity ${id} not found`);
    if (body.version !== undefined && body.version !== entity.version) {
      throw new UpstreamError(409, 'CONFLICT', 'Version mismatch');
    }
    if (body.content !== undefined) entity.content = body.content;
    if (body.status !== undefined) entity.status = body.status;
    if (body.tags !== undefined) entity.tags = body.tags;
    if (body.visibility !== undefined) entity.visibility = body.visibility;
    if (body.metadata !== undefined) {
      entity.metadata = { ...(entity.metadata ?? {}), ...JSON.parse(JSON.stringify(body.metadata)) };
    }
    entity.version += 1;
    entity.updated_at = new Date().toISOString();
    return JSON.parse(JSON.stringify(entity));
  }

  async completeTask(id: string, version: number): Promise<RawEntity> {
    const entity = this.tasks.get(id);
    if (!entity) throw new UpstreamError(404, 'NOT_FOUND', `Entity ${id} not found`);
    if (version !== entity.version) {
      throw new UpstreamError(409, 'CONFLICT', 'Version mismatch');
    }
    entity.status = 'done';
    entity.version += 1;
    entity.updated_at = new Date().toISOString();
    return JSON.parse(JSON.stringify(entity));
  }

  async deleteEntity(id: string): Promise<void> {
    if (!this.tasks.has(id)) throw new UpstreamError(404, 'NOT_FOUND', `Entity ${id} not found`);
    this.tasks.delete(id);
  }

  async listEdges(id: string): Promise<RawEdge[]> {
    return this.edges.filter((e) => e.source_id === id || e.target_id === id);
  }

  async createEdge(sourceId: string, targetId: string, relation: string): Promise<RawEdge> {
    const edge: RawEdge = { id: randomUUID(), source_id: sourceId, target_id: targetId, relation };
    this.edges.push(edge);
    return edge;
  }

  async deleteEdge(id: string): Promise<void> {
    this.edges = this.edges.filter((e) => e.id !== id);
  }

  async listTasks() { return []; }
  async listTasksPage() { return { items: [], total: 0 }; }
  async listProjects() { return []; }
  async createEntity() { throw new Error('not implemented'); }
  async updateEntity() { throw new Error('not implemented'); }
  async search() { return []; }
}

describe('server recurrence and lifecycle (T2)', () => {
  let fakePg: FakePostgramClient;
  let app: ReturnType<typeof createApp>;
  // Wednesday 2026-09-30 in Amsterdam
  const mockNow = () => new Date('2026-09-30T12:00:00Z');

  beforeEach(() => {
    fakePg = new FakePostgramClient();
    app = createApp(config, fakePg as unknown as PostgramClient, { now: mockNow });
  });

  it('(a) complete a weekly task -> response next has correct dates and recurrence_parent_id; fake store has exactly 2 tasks; completed task has recurrence_next_id', async () => {
    const taskId = randomUUID();
    fakePg.tasks.set(taskId, {
      id: taskId,
      type: 'task',
      content: 'Weekly meeting',
      visibility: 'personal',
      status: 'next',
      version: 1,
      tags: ['work'],
      metadata: {
        due_date: '2026-09-28', // Monday
        recurrence: { type: 'weekly', interval: 1, weekdays: [1] }
      },
      created_at: '2026-09-28T09:00:00Z',
      updated_at: '2026-09-28T09:00:00Z'
    });

    const res = await app.request(`/api/tasks/${taskId}/complete`, {
      method: 'POST',
      headers: authedHeaders,
      body: JSON.stringify({ version: 1 })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.task.status).toBe('done');
    expect(data.next).toBeDefined();
    expect(data.next.metadata.recurrence_parent_id).toBe(taskId);
    // Weekly on Monday [1], base = 2026-09-30 (Wednesday), next occurrence is Monday 2026-10-05
    expect(data.next.metadata.due_date).toBe('2026-10-05');
    expect(data.next.metadata.start_date).toBeNull();

    expect(fakePg.tasks.size).toBe(2);
    const completedInStore = fakePg.tasks.get(taskId)!;
    expect(completedInStore.metadata?.recurrence_next_id).toBe(data.next.id);
  });

  it('(b) calling complete again (same version) -> 200, same next.id, still 2 tasks', async () => {
    const taskId = randomUUID();
    fakePg.tasks.set(taskId, {
      id: taskId,
      type: 'task',
      content: 'Weekly meeting',
      visibility: 'personal',
      status: 'next',
      version: 1,
      tags: [],
      metadata: {
        due_date: '2026-09-28',
        recurrence: { type: 'weekly', interval: 1, weekdays: [1] }
      },
      created_at: '2026-09-28T09:00:00Z',
      updated_at: '2026-09-28T09:00:00Z'
    });

    const res1 = await app.request(`/api/tasks/${taskId}/complete`, {
      method: 'POST',
      headers: authedHeaders,
      body: JSON.stringify({ version: 1 })
    });
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    const nextId = data1.next.id;
    expect(fakePg.tasks.size).toBe(2);

    // Call complete again with the original version (idempotent when status === done)
    const res2 = await app.request(`/api/tasks/${taskId}/complete`, {
      method: 'POST',
      headers: authedHeaders,
      body: JSON.stringify({ version: 1 })
    });
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.next.id).toBe(nextId);
    expect(fakePg.tasks.size).toBe(2);
  });

  it('(c) completed_on 3 days ago is used for after_completion; completed_on 40 days ago is ignored (server today used)', async () => {
    // Case 1: completed_on 3 days ago (2026-09-27)
    const task1Id = randomUUID();
    fakePg.tasks.set(task1Id, {
      id: task1Id,
      type: 'task',
      content: 'After task 1',
      visibility: 'personal',
      status: 'next',
      version: 1,
      tags: [],
      metadata: {
        recurrence: { type: 'after_completion', every: 1, unit: 'day' }
      },
      created_at: '2026-09-20T00:00:00Z',
      updated_at: '2026-09-20T00:00:00Z'
    });

    const res1 = await app.request(`/api/tasks/${task1Id}/complete`, {
      method: 'POST',
      headers: authedHeaders,
      body: JSON.stringify({ version: 1, completed_on: '2026-09-27' })
    });
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.next.metadata.start_date).toBe('2026-09-28');

    // Case 2: completed_on 40 days ago (2026-08-21) -> ignored, uses serverToday (2026-09-30)
    const task2Id = randomUUID();
    fakePg.tasks.set(task2Id, {
      id: task2Id,
      type: 'task',
      content: 'After task 2',
      visibility: 'personal',
      status: 'next',
      version: 1,
      tags: [],
      metadata: {
        recurrence: { type: 'after_completion', every: 1, unit: 'day' }
      },
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-01T00:00:00Z'
    });

    const res2 = await app.request(`/api/tasks/${task2Id}/complete`, {
      method: 'POST',
      headers: authedHeaders,
      body: JSON.stringify({ version: 1, completed_on: '2026-08-21' })
    });
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.next.metadata.start_date).toBe('2026-10-01');
  });

  it('(d) reopen deletes the untouched successor and returns removedNextId', async () => {
    const taskId = randomUUID();
    fakePg.tasks.set(taskId, {
      id: taskId,
      type: 'task',
      content: 'Recurring task',
      visibility: 'personal',
      status: 'next',
      version: 1,
      tags: [],
      metadata: {
        due_date: '2026-09-28',
        recurrence: { type: 'daily', interval: 1 }
      },
      created_at: '2026-09-28T00:00:00Z',
      updated_at: '2026-09-28T00:00:00Z'
    });

    const completeRes = await app.request(`/api/tasks/${taskId}/complete`, {
      method: 'POST',
      headers: authedHeaders,
      body: JSON.stringify({ version: 1 })
    });
    const completeData = await completeRes.json();
    const nextId = completeData.next.id;
    expect(fakePg.tasks.has(nextId)).toBe(true);

    const completedTask = fakePg.tasks.get(taskId)!;
    const reopenRes = await app.request(`/api/tasks/${taskId}/reopen`, {
      method: 'POST',
      headers: authedHeaders,
      body: JSON.stringify({ version: completedTask.version })
    });

    expect(reopenRes.status).toBe(200);
    const reopenData = await reopenRes.json();
    expect(reopenData.removedNextId).toBe(nextId);
    expect(fakePg.tasks.has(nextId)).toBe(false);
    expect(reopenData.task.status).toBe('next');
    expect(reopenData.task.metadata.recurrence_next_id).toBeNull();
  });

  it('(e) reopen when successor was deleted (fake getEntity 404) still reopens', async () => {
    const taskId = randomUUID();
    const phantomNextId = randomUUID();
    fakePg.tasks.set(taskId, {
      id: taskId,
      type: 'task',
      content: 'Task with deleted successor',
      visibility: 'personal',
      status: 'done',
      version: 2,
      tags: [],
      metadata: {
        completed_at: '2026-09-29T10:00:00Z',
        recurrence_next_id: phantomNextId
      },
      created_at: '2026-09-28T00:00:00Z',
      updated_at: '2026-09-29T10:00:00Z'
    });

    const res = await app.request(`/api/tasks/${taskId}/reopen`, {
      method: 'POST',
      headers: authedHeaders,
      body: JSON.stringify({ version: 2 })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.removedNextId).toBeNull();
    expect(data.task.status).toBe('next');
    expect(data.task.metadata.recurrence_next_id).toBeNull();
  });

  it('(f) reopen when successor has version 2 keeps it', async () => {
    const taskId = randomUUID();
    const successorId = randomUUID();
    fakePg.tasks.set(taskId, {
      id: taskId,
      type: 'task',
      content: 'Original task',
      visibility: 'personal',
      status: 'done',
      version: 2,
      tags: [],
      metadata: {
        completed_at: '2026-09-29T10:00:00Z',
        recurrence_next_id: successorId
      },
      created_at: '2026-09-28T00:00:00Z',
      updated_at: '2026-09-29T10:00:00Z'
    });
    // Successor was edited by the user, so version is 2
    fakePg.tasks.set(successorId, {
      id: successorId,
      type: 'task',
      content: 'Successor task edited',
      visibility: 'personal',
      status: 'next',
      version: 2,
      tags: [],
      metadata: {
        recurrence_parent_id: taskId
      },
      created_at: '2026-09-29T10:00:00Z',
      updated_at: '2026-09-29T11:00:00Z'
    });

    const res = await app.request(`/api/tasks/${taskId}/reopen`, {
      method: 'POST',
      headers: authedHeaders,
      body: JSON.stringify({ version: 2 })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.removedNextId).toBeNull();
    expect(fakePg.tasks.has(successorId)).toBe(true);
    expect(data.task.status).toBe('next');
  });

  it('(g) PATCH with metadata.recurrence_next_id -> 400', async () => {
    const taskId = randomUUID();
    fakePg.tasks.set(taskId, {
      id: taskId,
      type: 'task',
      content: 'Task to patch',
      visibility: 'personal',
      status: 'next',
      version: 1,
      tags: [],
      metadata: {},
      created_at: '2026-09-28T00:00:00Z',
      updated_at: '2026-09-28T00:00:00Z'
    });

    const res = await app.request(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: authedHeaders,
      body: JSON.stringify({
        version: 1,
        metadata: { recurrence_next_id: randomUUID() }
      })
    });

    expect(res.status).toBe(400);
  });

  it('(h) GET /api/login -> 302 /', async () => {
    const res = await app.request('/api/login', {
      method: 'GET',
      headers: {
        'x-proxy-secret': SECRET,
        'x-cosmos-user': 'alice'
      }
    });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });
});
