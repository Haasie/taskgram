import { Hono } from 'hono';
import { z } from 'zod';
import { addDays, todayInZone } from '../shared/dates.js';
import { nextTaskDates } from '../shared/recurrence.js';
import { startDate } from '../shared/taskFields.js';
import type { LinkedEntity, Task } from '../shared/types.js';
import type { AuthEnv } from './auth.js';
import { toProject, toTask, truncate } from './mappers.js';
import { UpstreamError, type PostgramClient } from './postgram.js';

const OPEN_STATUSES = ['inbox', 'next', 'active', 'waiting', 'scheduled', 'someday'] as const;
const PROJECT_RELATION = 'part_of';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const status = z.enum(['inbox', 'next', 'active', 'waiting', 'scheduled', 'someday', 'done', 'archived']);
const visibility = z.enum(['personal', 'work', 'shared']);
const tags = z.array(z.string().trim().min(1).max(64)).max(30);

const recurrenceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('daily'), interval: z.number().int().min(1).max(365) }).strict(),
  z
    .object({
      type: z.literal('weekly'),
      interval: z.number().int().min(1).max(52),
      weekdays: z
        .array(z.number().int().min(0).max(6))
        .min(1)
        .max(7)
        .transform((w) => [...new Set(w)].sort((a, b) => a - b))
    })
    .strict(),
  z.object({ type: z.literal('monthly'), interval: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) }).strict(),
  z.object({ type: z.literal('after_completion'), every: z.number().int().min(1).max(365), unit: z.enum(['day', 'week']) }).strict()
]);

const metadataPatch = z
  .object({
    context: z.string().max(4000).nullable(),
    due_date: date.nullable(),
    start_date: date.nullable(),
    evening: z.boolean().nullable(),
    checklist: z
      .array(z.object({ id: z.string().min(1).max(64), text: z.string().max(500), done: z.boolean() }).strict())
      .max(200)
      .nullable(),
    project_id: uuid.nullable(),
    sort_order: z.number().finite().nullable(),
    completed_at: z.string().max(40).nullable(),
    recurrence: recurrenceSchema.nullable(),
    reminder_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable()
  })
  .partial()
  .strict();

const taskCreate = z
  .object({
    content: z.string().trim().min(1).max(20_000),
    status: status.optional(),
    tags: tags.optional(),
    visibility: visibility.optional(),
    metadata: metadataPatch.optional()
  })
  .strict();

const taskUpdate = z
  .object({
    version: z.number().int().positive(),
    content: z.string().trim().min(1).max(20_000).optional(),
    status: status.optional(),
    tags: tags.optional(),
    visibility: visibility.optional(),
    metadata: metadataPatch.optional()
  })
  .strict();

const versionOnly = z.object({ version: z.number().int().positive() }).strict();
const completeBody = z
  .object({
    version: z.number().int().positive(),
    completed_on: date.optional()
  })
  .strict();
const linkCreate = z
  .object({ target_id: uuid, relation: z.string().regex(/^[a-z_]{1,40}$/).default('related_to') })
  .strict();
const searchBody = z.object({ query: z.string().trim().min(1).max(500) }).strict();
const projectCreate = z
  .object({ content: z.string().trim().min(1).max(20_000), visibility: visibility.optional() })
  .strict();
const projectUpdate = z
  .object({
    version: z.number().int().positive(),
    content: z.string().trim().min(1).max(20_000).optional(),
    status: z.enum(['active', 'done', 'archived']).optional(),
    visibility: visibility.optional()
  })
  .strict();

function notFound(what: string): never {
  throw new UpstreamError(404, 'NOT_FOUND', `${what} not found`);
}

export function createApiRoutes(pg: PostgramClient, opts?: { timeZone?: string; now?: () => Date }) {
  const api = new Hono<AuthEnv>();
  const timeZone = opts?.timeZone ?? 'Europe/Amsterdam';
  const now = opts?.now ?? (() => new Date());

  const param = (value: string | undefined) => uuid.parse(value);

  async function requireType(id: string, type: 'task' | 'project') {
    const entity = await pg.getEntity(id);
    if (entity.type !== type) notFound(type === 'task' ? 'Task' : 'Project');
    return entity;
  }

  async function setProjectEdge(taskId: string, projectId: string | null, previousId: string | null) {
    if (projectId === previousId) return;
    if (previousId) {
      const edges = await pg.listEdges(taskId);
      await Promise.all(
        edges
          .filter((e) => e.relation === PROJECT_RELATION && e.source_id === taskId && e.target_id === previousId)
          .map((e) => pg.deleteEdge(e.id))
      );
    }
    if (projectId) await pg.createEdge(taskId, projectId, PROJECT_RELATION);
  }

  api.get('/login', (c) => c.redirect('/', 302));

  api.get('/me', (c) => c.json({ user: c.get('user') }));

  api.get('/tasks', async (c) => {
    const lists = await Promise.all(OPEN_STATUSES.map((s) => pg.listTasks(s)));
    return c.json({ items: lists.flat().map(toTask) });
  });

  api.get('/tasks/:id', async (c) => {
    const id = param(c.req.param('id'));
    const entity = await requireType(id, 'task');
    return c.json({ task: toTask(entity) });
  });

  api.get('/logbook', async (c) => {
    const offset = z.coerce.number().int().min(0).max(100_000).parse(c.req.query('offset') ?? 0);
    const page = await pg.listTasksPage('done', 100, offset);
    return c.json({ items: page.items.map(toTask), total: page.total });
  });

  api.post('/tasks', async (c) => {
    const body = taskCreate.parse(await c.req.json());
    const projectId = body.metadata?.project_id ?? null;
    if (projectId) await requireType(projectId, 'project');

    const created = await pg.createTask({
      content: body.content,
      status: body.status ?? 'inbox',
      tags: body.tags ?? [],
      visibility: body.visibility ?? 'personal',
      metadata: body.metadata ?? {}
    });
    if (projectId) await setProjectEdge(created.id, projectId, null);
    return c.json({ task: toTask(created) }, 201);
  });

  api.patch('/tasks/:id', async (c) => {
    const id = param(c.req.param('id'));
    const body = taskUpdate.parse(await c.req.json());
    const current = await requireType(id, 'task');

    const nextProject = body.metadata?.project_id;
    if (nextProject) await requireType(nextProject, 'project');

    const updated = await pg.updateTask(id, body);
    if (nextProject !== undefined) {
      const previous = (current.metadata?.project_id as string | undefined) ?? null;
      await setProjectEdge(id, nextProject, previous);
    }
    return c.json({ task: toTask(updated) });
  });

  api.post('/tasks/:id/complete', async (c) => {
    const id = param(c.req.param('id'));
    const body = completeBody.parse(await c.req.json());
    const cur = await requireType(id, 'task');

    if (cur.status === 'done') {
      let next: Task | null = null;
      const nextId = typeof cur.metadata?.recurrence_next_id === 'string' ? cur.metadata.recurrence_next_id : null;
      if (nextId) {
        try {
          const nextEntity = await pg.getEntity(nextId);
          if (nextEntity.type === 'task') {
            next = toTask(nextEntity);
          }
        } catch {
          next = null;
        }
      }
      return c.json({ task: toTask(cur), next });
    }

    const done = await pg.completeTask(id, body.version);

    const ruleParsed = recurrenceSchema.safeParse(cur.metadata?.recurrence);
    if (ruleParsed.success && ruleParsed.data !== null) {
      try {
        const serverToday = todayInZone(now(), timeZone);
        const minDate = addDays(serverToday, -30);
        const completedOn =
          body.completed_on && body.completed_on >= minDate && body.completed_on <= serverToday
            ? body.completed_on
            : serverToday;

        const curTask = toTask(cur);
        const nextDates = nextTaskDates(curTask, completedOn);
        const successorStatus = nextDates.start_date && nextDates.start_date > completedOn ? 'scheduled' : 'next';

        const successorMetadata: Record<string, unknown> = {
          start_date: nextDates.start_date,
          due_date: nextDates.due_date,
          recurrence_parent_id: cur.id,
          recurrence: ruleParsed.data,
          reminder_time: (cur.metadata?.reminder_time as string | null | undefined) ?? null,
          context: (cur.metadata?.context as string | null | undefined) ?? null,
          evening: (cur.metadata?.evening as boolean | null | undefined) ?? null,
          project_id: (cur.metadata?.project_id as string | null | undefined) ?? null,
          checklist: Array.isArray(cur.metadata?.checklist)
            ? cur.metadata.checklist.map((item: any) => ({ ...item, done: false }))
            : null
        };

        const successor = await pg.createTask({
          content: cur.content ?? '',
          status: successorStatus,
          tags: cur.tags ?? [],
          visibility: cur.visibility ?? 'personal',
          metadata: successorMetadata
        });

        const projectId = (cur.metadata?.project_id as string | undefined) ?? null;
        if (projectId) {
          await setProjectEdge(successor.id, projectId, null);
        }

        const patchedDone = await pg.updateTask(cur.id, {
          version: done.version,
          metadata: { recurrence_next_id: successor.id }
        });

        return c.json({ task: toTask(patchedDone), next: toTask(successor) });
      } catch (err) {
        console.error('[recurrence] Failed to create successor:', err);
        return c.json({ task: toTask(done), next: null, warning: 'Next recurrence could not be created' });
      }
    }

    return c.json({ task: toTask(done), next: null });
  });

  api.post('/tasks/:id/reopen', async (c) => {
    const id = param(c.req.param('id'));
    const body = versionOnly.parse(await c.req.json());
    const cur = await requireType(id, 'task');

    if (cur.status !== 'done') {
      return c.json({ task: toTask(cur), removedNextId: null });
    }

    let removedNextId: string | null = null;
    const nextId = typeof cur.metadata?.recurrence_next_id === 'string' ? cur.metadata.recurrence_next_id : null;
    if (nextId) {
      try {
        const nextEntity = await pg.getEntity(nextId);
        const isOpenTask =
          nextEntity.type === 'task' && nextEntity.status !== 'done' && nextEntity.status !== 'archived';
        if (isOpenTask && nextEntity.version === 1) {
          try {
            await pg.deleteEntity(nextId);
            removedNextId = nextId;
          } catch (delErr) {
            if (delErr instanceof UpstreamError && delErr.status === 404) {
              // ignored
            } else {
              throw delErr;
            }
          }
        }
      } catch (fetchErr) {
        if (fetchErr instanceof UpstreamError && fetchErr.status === 404) {
          // 404 (already deleted) means "nothing to remove" and execution continues
        } else {
          throw fetchErr;
        }
      }
    }

    const curTask = toTask(cur);
    const start = startDate(curTask);
    const serverToday = todayInZone(now(), timeZone);
    const targetStatus = start && start > serverToday ? 'scheduled' : 'next';

    const patched = await pg.updateTask(cur.id, {
      version: body.version,
      status: targetStatus,
      metadata: {
        completed_at: null,
        recurrence_next_id: null
      }
    });

    return c.json({ task: toTask(patched), removedNextId });
  });

  api.delete('/tasks/:id', async (c) => {
    const id = param(c.req.param('id'));
    const version = z.coerce.number().int().positive().parse(c.req.query('version'));
    const entity = await requireType(id, 'task');
    if (entity.version !== version) {
      throw new UpstreamError(409, 'CONFLICT', 'Version conflict');
    }
    await pg.deleteEntity(id);
    return c.json({ ok: true });
  });

  api.get('/tasks/:id/links', async (c) => {
    const id = param(c.req.param('id'));
    await requireType(id, 'task');
    const edges = (await pg.listEdges(id)).slice(0, 30);
    const links: LinkedEntity[] = await Promise.all(
      edges.map(async (edge) => {
        const outgoing = edge.source_id === id;
        const otherId = outgoing ? edge.target_id : edge.source_id;
        const other = await pg.getEntity(otherId).catch(() => null);
        return {
          edgeId: edge.id,
          relation: edge.relation,
          direction: outgoing ? 'outgoing' : 'incoming',
          entity: other
            ? { id: other.id, type: other.type, content: truncate(other.content, 600), tags: other.tags ?? [] }
            : null
        } satisfies LinkedEntity;
      })
    );
    return c.json({ links });
  });

  api.post('/tasks/:id/links', async (c) => {
    const id = param(c.req.param('id'));
    const body = linkCreate.parse(await c.req.json());
    await requireType(id, 'task');
    if (body.target_id === id) throw new UpstreamError(400, 'VALIDATION', 'Cannot link task to itself');
    const edge = await pg.createEdge(id, body.target_id, body.relation);
    return c.json({ edgeId: edge.id }, 201);
  });

  api.delete('/tasks/:id/links/:edgeId', async (c) => {
    const id = param(c.req.param('id'));
    const edgeId = param(c.req.param('edgeId'));
    await requireType(id, 'task');
    const edge = (await pg.listEdges(id)).find((e) => e.id === edgeId);
    if (!edge) notFound('Link');
    await pg.deleteEdge(edgeId);
    return c.json({ ok: true });
  });

  api.post('/search', async (c) => {
    const { query } = searchBody.parse(await c.req.json());
    const results = await pg.search(query);
    return c.json({
      hits: results.map((r) => ({
        id: r.entity.id,
        type: r.entity.type,
        content: truncate(r.entity.content, 240),
        score: r.score
      }))
    });
  });

  api.get('/projects', async (c) => {
    const projects = await pg.listProjects();
    return c.json({ items: projects.filter((p) => p.status !== 'archived').map(toProject) });
  });

  api.post('/projects', async (c) => {
    const body = projectCreate.parse(await c.req.json());
    const created = await pg.createEntity({
      type: 'project',
      content: body.content,
      status: 'active',
      visibility: body.visibility ?? 'personal'
    });
    return c.json({ project: toProject(created) }, 201);
  });

  api.patch('/projects/:id', async (c) => {
    const id = param(c.req.param('id'));
    const body = projectUpdate.parse(await c.req.json());
    await requireType(id, 'project');
    return c.json({ project: toProject(await pg.updateEntity(id, body)) });
  });

  return api;
}
