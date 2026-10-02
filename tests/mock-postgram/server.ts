import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import crypto from 'node:crypto';
import type { RawEdge, RawEntity } from '../../server/postgram.js';
import { createFixtures } from './fixtures.js';

const app = new Hono();

const initial = createFixtures();
const entities = new Map<string, RawEntity>(initial.entities.map((e) => [e.id, { ...e }]));
let edges: RawEdge[] = initial.edges.map((e) => ({ ...e }));

function resetState() {
  entities.clear();
  const f = createFixtures();
  for (const e of f.entities) {
    entities.set(e.id, { ...e });
  }
  edges = f.edges.map((e) => ({ ...e }));
}

// Test hooks
app.post('/__reset', (c) => {
  resetState();
  return c.json({ ok: true });
});

app.get('/__state', (c) => {
  return c.json({
    entities: Array.from(entities.values()),
    edges: [...edges]
  });
});

app.post('/__bump/:id', (c) => {
  const id = c.req.param('id');
  const entity = entities.get(id);
  if (!entity) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Entity not found' } }, 404);
  }
  entity.content = `${entity.content ?? ''} (extern gewijzigd)`;
  entity.version += 1;
  entity.updated_at = new Date().toISOString();
  return c.json({ entity });
});

// Bearer token check for /api/*
app.use('/api/*', async (c, next) => {
  const auth = c.req.header('authorization');
  if (auth !== 'Bearer test') {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }, 401);
  }
  await next();
});

// Tasks endpoints
app.get('/api/tasks', (c) => {
  const status = c.req.query('status');
  const limit = Number(c.req.query('limit') ?? 200);
  const offset = Number(c.req.query('offset') ?? 0);

  let filtered = Array.from(entities.values()).filter((e) => e.type === 'task');
  if (status) {
    filtered = filtered.filter((e) => e.status === status);
  }
  const page = filtered.slice(offset, offset + limit);
  return c.json({
    items: page,
    total: filtered.length,
    limit,
    offset
  });
});

app.post('/api/tasks', async (c) => {
  const body = (await c.req.json()) as Partial<RawEntity>;
  const id = body.id || crypto.randomUUID();
  const now = new Date().toISOString();
  const entity: RawEntity = {
    id,
    type: 'task',
    content: body.content ?? '',
    status: body.status ?? 'inbox',
    visibility: body.visibility ?? 'personal',
    version: 1,
    tags: body.tags ?? [],
    metadata: body.metadata ?? {},
    created_at: now,
    updated_at: now
  };
  entities.set(id, entity);
  return c.json({ entity }, 201);
});

app.patch('/api/tasks/:id', async (c) => {
  const id = c.req.param('id');
  const entity = entities.get(id);
  if (!entity || entity.type !== 'task') {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Task not found' } }, 404);
  }
  const body = (await c.req.json()) as {
    version: number;
    content?: string;
    status?: string;
    tags?: string[];
    visibility?: 'personal' | 'work' | 'shared';
    metadata?: Record<string, unknown>;
  };
  if (body.version !== undefined && entity.version !== body.version) {
    return c.json({ error: { code: 'CONFLICT', message: 'Version conflict' } }, 409);
  }
  if (body.content !== undefined) entity.content = body.content;
  if (body.status !== undefined) entity.status = body.status;
  if (body.tags !== undefined) entity.tags = body.tags;
  if (body.visibility !== undefined) entity.visibility = body.visibility;
  if (body.metadata !== undefined) {
    entity.metadata = { ...(entity.metadata ?? {}), ...body.metadata };
  }
  entity.version += 1;
  entity.updated_at = new Date().toISOString();
  return c.json({ entity });
});

app.post('/api/tasks/:id/complete', async (c) => {
  const id = c.req.param('id');
  const entity = entities.get(id);
  if (!entity || entity.type !== 'task') {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Task not found' } }, 404);
  }
  const body = (await c.req.json()) as { version: number };
  if (body.version !== undefined && entity.version !== body.version) {
    return c.json({ error: { code: 'CONFLICT', message: 'Version conflict' } }, 409);
  }
  const now = new Date().toISOString();
  entity.status = 'done';
  entity.metadata = { ...(entity.metadata ?? {}), completed_at: now };
  entity.version += 1;
  entity.updated_at = now;
  return c.json({ entity });
});

// Entities endpoints
app.get('/api/entities/:id', (c) => {
  const id = c.req.param('id');
  const entity = entities.get(id);
  if (!entity) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Entity not found' } }, 404);
  }
  return c.json({ entity });
});

app.get('/api/entities', (c) => {
  const type = c.req.query('type');
  const limit = Number(c.req.query('limit') ?? 200);
  const offset = Number(c.req.query('offset') ?? 0);

  let filtered = Array.from(entities.values());
  if (type) {
    filtered = filtered.filter((e) => e.type === type);
  }
  const page = filtered.slice(offset, offset + limit);
  return c.json({
    items: page,
    total: filtered.length,
    limit,
    offset
  });
});

app.post('/api/entities', async (c) => {
  const body = (await c.req.json()) as Partial<RawEntity>;
  const id = body.id || crypto.randomUUID();
  const now = new Date().toISOString();
  const entity: RawEntity = {
    id,
    type: body.type ?? 'task',
    content: body.content ?? '',
    status: body.status ?? (body.type === 'project' ? 'active' : 'inbox'),
    visibility: body.visibility ?? 'personal',
    version: 1,
    tags: body.tags ?? [],
    metadata: body.metadata ?? {},
    created_at: now,
    updated_at: now
  };
  entities.set(id, entity);
  return c.json({ entity }, 201);
});

app.patch('/api/entities/:id', async (c) => {
  const id = c.req.param('id');
  const entity = entities.get(id);
  if (!entity) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Entity not found' } }, 404);
  }
  const body = (await c.req.json()) as {
    version: number;
    content?: string;
    status?: string;
    tags?: string[];
    visibility?: 'personal' | 'work' | 'shared';
    metadata?: Record<string, unknown>;
  };
  if (body.version !== undefined && entity.version !== body.version) {
    return c.json({ error: { code: 'CONFLICT', message: 'Version conflict' } }, 409);
  }
  if (body.content !== undefined) entity.content = body.content;
  if (body.status !== undefined) entity.status = body.status;
  if (body.tags !== undefined) entity.tags = body.tags;
  if (body.visibility !== undefined) entity.visibility = body.visibility;
  if (body.metadata !== undefined) {
    entity.metadata = { ...(entity.metadata ?? {}), ...body.metadata };
  }
  entity.version += 1;
  entity.updated_at = new Date().toISOString();
  return c.json({ entity });
});

app.delete('/api/entities/:id', (c) => {
  const id = c.req.param('id');
  const entity = entities.get(id);
  if (!entity) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Entity not found' } }, 404);
  }
  entity.status = 'archived';
  entity.version += 1;
  entity.updated_at = new Date().toISOString();
  return c.json({ ok: true });
});

// Edges endpoints
app.get('/api/entities/:id/edges', (c) => {
  const id = c.req.param('id');
  const matched = edges.filter((e) => e.source_id === id || e.target_id === id);
  return c.json({ edges: matched });
});

app.post('/api/edges', async (c) => {
  const body = (await c.req.json()) as { source_id: string; target_id: string; relation: string; id?: string };
  const edge: RawEdge = {
    id: body.id || crypto.randomUUID(),
    source_id: body.source_id,
    target_id: body.target_id,
    relation: body.relation ?? 'related_to'
  };
  edges.push(edge);
  return c.json({ edge }, 201);
});

app.delete('/api/edges/:id', (c) => {
  const id = c.req.param('id');
  edges = edges.filter((e) => e.id !== id);
  return c.json({ ok: true });
});

// Search endpoint
app.post('/api/search', async (c) => {
  const body = (await c.req.json()) as { query?: string; limit?: number };
  const query = String(body.query ?? '').toLowerCase();
  const limit = Number(body.limit ?? 12);
  const matched = Array.from(entities.values())
    .filter((e) => e.status !== 'archived' && (e.content ?? '').toLowerCase().includes(query))
    .slice(0, limit)
    .map((entity) => ({ entity, score: 1 }));
  return c.json({ results: matched });
});

const PORT = 4010;
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Mock Postgram running on http://localhost:${PORT}`);
});
