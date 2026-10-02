import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Task, Visibility } from '../../shared/types.js';
import { ApiError } from './api';
import {
  applyOutbox,
  createOutboxEngine,
  rebaseDecision,
  rewriteTaskId,
  type Conflict,
  type OutboxApi,
  type OutboxOp,
  type OutboxStorage
} from './outbox';

function createMemoryStorage(initial: Record<string, unknown> = {}): OutboxStorage & { dump: () => Map<string, unknown> } {
  const map = new Map<string, unknown>(Object.entries(initial));
  return {
    get: async <T>(key: string) => map.get(key) as T | undefined,
    set: async <T>(key: string, value: T) => {
      map.set(key, value);
    },
    dump: () => map
  };
}

function sampleTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    version: 1,
    content: 'Initial task title\nInitial notes',
    status: 'next',
    visibility: 'personal' as Visibility,
    tags: ['tag1'],
    metadata: {
      due_date: '2026-10-10',
      checklist: [{ id: 'c1', text: 'Step 1', done: false }]
    },
    createdAt: '2026-09-30T10:00:00.000Z',
    updatedAt: '2026-09-30T10:00:00.000Z',
    ...overrides
  };
}

describe('applyOutbox', () => {
  it('overlays create (adds tmp task with version 0 and matching fields)', () => {
    const serverTasks: Task[] = [sampleTask({ id: 'task-1' })];
    const ops: OutboxOp[] = [
      {
        id: 'op-1',
        kind: 'create',
        taskId: 'tmp-1',
        input: {
          content: 'Offline created task',
          status: 'inbox',
          visibility: 'work',
          tags: ['offline'],
          metadata: { project_id: 'p1' }
        },
        createdAt: '2026-09-30T12:00:00.000Z'
      }
    ];

    const result = applyOutbox(serverTasks, ops);
    expect(result).toHaveLength(2);
    const tmp = result.find((t) => t.id === 'tmp-1');
    expect(tmp).toBeDefined();
    expect(tmp?.version).toBe(0);
    expect(tmp?.content).toBe('Offline created task');
    expect(tmp?.status).toBe('inbox');
    expect(tmp?.visibility).toBe('work');
    expect(tmp?.tags).toEqual(['offline']);
    expect(tmp?.metadata.project_id).toBe('p1');
  });

  it('overlays update (patch applied on top of server data, server version kept)', () => {
    const serverTask = sampleTask({ id: 'task-1', version: 5, content: 'Original' });
    const ops: OutboxOp[] = [
      {
        id: 'op-2',
        kind: 'update',
        taskId: 'task-1',
        patch: { content: 'Patched content', metadata: { due_date: '2026-11-01' } },
        base: { content: 'Original' },
        createdAt: '2026-09-30T12:00:00.000Z'
      }
    ];

    const result = applyOutbox([serverTask], ops);
    expect(result).toHaveLength(1);
    expect(result[0]?.content).toBe('Patched content');
    expect(result[0]?.metadata.due_date).toBe('2026-11-01');
    // Original checklist retained
    expect(result[0]?.metadata.checklist).toEqual([{ id: 'c1', text: 'Step 1', done: false }]);
    // Server version kept!
    expect(result[0]?.version).toBe(5);
  });

  it('overlays complete (status done, server version kept)', () => {
    const serverTask = sampleTask({ id: 'task-1', version: 3, status: 'next' });
    const ops: OutboxOp[] = [
      {
        id: 'op-3',
        kind: 'complete',
        taskId: 'task-1',
        createdAt: '2026-09-30T12:00:00.000Z'
      }
    ];

    const result = applyOutbox([serverTask], ops);
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe('done');
    expect(result[0]?.version).toBe(3);
  });

  it('overlays reopen (status restored, server version kept)', () => {
    const serverTask = sampleTask({ id: 'task-1', version: 7, status: 'done' });
    const ops: OutboxOp[] = [
      {
        id: 'op-4',
        kind: 'reopen',
        taskId: 'task-1',
        createdAt: '2026-09-30T12:00:00.000Z'
      }
    ];

    const result = applyOutbox([serverTask], ops);
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe('next');
    expect(result[0]?.version).toBe(7);
  });

  it('overlays delete (task removed from list)', () => {
    const serverTasks = [sampleTask({ id: 'task-1' }), sampleTask({ id: 'task-2' })];
    const ops: OutboxOp[] = [
      {
        id: 'op-5',
        kind: 'delete',
        taskId: 'task-1',
        createdAt: '2026-09-30T12:00:00.000Z'
      }
    ];

    const result = applyOutbox(serverTasks, ops);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('task-2');
  });

  it('applies sequential operations on created task', () => {
    const ops: OutboxOp[] = [
      {
        id: 'op-1',
        kind: 'create',
        taskId: 'tmp-1',
        input: { content: 'Offline title', status: 'next' },
        createdAt: '2026-09-30T12:00:00.000Z'
      },
      {
        id: 'op-2',
        kind: 'update',
        taskId: 'tmp-1',
        patch: { content: 'Offline title updated' },
        base: { content: 'Offline title' },
        createdAt: '2026-09-30T12:01:00.000Z'
      },
      {
        id: 'op-3',
        kind: 'complete',
        taskId: 'tmp-1',
        createdAt: '2026-09-30T12:02:00.000Z'
      }
    ];

    const result = applyOutbox([], ops);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('tmp-1');
    expect(result[0]?.content).toBe('Offline title updated');
    expect(result[0]?.status).toBe('done');
  });
});

describe('rewriteTaskId', () => {
  it('rewrites later ops with the real task ID', () => {
    const ops: OutboxOp[] = [
      {
        id: 'op-1',
        kind: 'update',
        taskId: 'tmp-1',
        patch: { content: 'Updated' },
        base: {},
        createdAt: '2026-09-30T12:01:00.000Z'
      },
      {
        id: 'op-2',
        kind: 'complete',
        taskId: 'tmp-1',
        createdAt: '2026-09-30T12:02:00.000Z'
      },
      {
        id: 'op-3',
        kind: 'update',
        taskId: 'other-task',
        patch: { content: 'Unrelated' },
        base: {},
        createdAt: '2026-09-30T12:03:00.000Z'
      }
    ];

    const rewritten = rewriteTaskId(ops, 'tmp-1', 'real-1');
    expect(rewritten[0]?.taskId).toBe('real-1');
    expect(rewritten[1]?.taskId).toBe('real-1');
    expect(rewritten[2]?.taskId).toBe('other-task');
  });
});

describe('rebaseDecision', () => {
  it('returns "retry" when every base field equals the server value', () => {
    const serverTask = sampleTask({
      content: 'Original title',
      metadata: { due_date: '2026-10-15', context: 'home' }
    });
    const op: OutboxOp = {
      id: 'op-1',
      kind: 'update',
      taskId: 'task-1',
      patch: { content: 'New title' },
      base: { content: 'Original title' },
      createdAt: '2026-09-30T12:00:00.000Z'
    };

    expect(rebaseDecision(op, serverTask)).toBe('retry');
  });

  it('returns "conflict" when a base field differs on server', () => {
    const serverTask = sampleTask({
      content: 'Server changed title',
      metadata: { due_date: '2026-10-15' }
    });
    const op: OutboxOp = {
      id: 'op-1',
      kind: 'update',
      taskId: 'task-1',
      patch: { content: 'My new title' },
      base: { content: 'Original title' },
      createdAt: '2026-09-30T12:00:00.000Z'
    };

    expect(rebaseDecision(op, serverTask)).toBe('conflict');
  });

  it('compares metadata keys individually', () => {
    // Server changed context, but our op only touched due_date
    const serverTask = sampleTask({
      metadata: {
        due_date: '2026-10-15',
        context: 'server changed context'
      }
    });
    const op: OutboxOp = {
      id: 'op-1',
      kind: 'update',
      taskId: 'task-1',
      patch: { metadata: { due_date: '2026-10-20' } },
      base: { 'metadata.due_date': '2026-10-15' },
      createdAt: '2026-09-30T12:00:00.000Z'
    };

    // Because base only recorded metadata.due_date, which matches server, this is 'retry'!
    expect(rebaseDecision(op, serverTask)).toBe('retry');

    // If metadata.due_date had changed on the server, it would be conflict
    const serverTaskWithChangedDue = sampleTask({
      metadata: { due_date: '2026-10-18', context: 'home' }
    });
    expect(rebaseDecision(op, serverTaskWithChangedDue)).toBe('conflict');
  });

  it('performs deep equality for arrays and objects', () => {
    const checklist = [
      { id: '1', text: 'A', done: false },
      { id: '2', text: 'B', done: true }
    ];
    const serverTask = sampleTask({
      metadata: { checklist }
    });
    const op: OutboxOp = {
      id: 'op-1',
      kind: 'update',
      taskId: 'task-1',
      patch: { metadata: { checklist: [...checklist, { id: '3', text: 'C', done: false }] } },
      base: { 'metadata.checklist': [
        { id: '1', text: 'A', done: false },
        { id: '2', text: 'B', done: true }
      ] },
      createdAt: '2026-09-30T12:00:00.000Z'
    };

    expect(rebaseDecision(op, serverTask)).toBe('retry');

    // Modifying one checklist item on server leads to conflict
    const modifiedServer = sampleTask({
      metadata: { checklist: [
        { id: '1', text: 'A changed', done: false },
        { id: '2', text: 'B', done: true }
      ] }
    });
    expect(rebaseDecision(op, modifiedServer)).toBe('conflict');
  });
});

describe('createOutboxEngine flush lifecycle', () => {
  let mockApi: OutboxApi;
  let storage: ReturnType<typeof createMemoryStorage>;
  let now: () => Date;

  beforeEach(() => {
    now = () => new Date('2026-09-30T14:30:00.000Z');
    storage = createMemoryStorage();
    mockApi = {
      tasks: vi.fn().mockResolvedValue([]),
      getTask: vi.fn(),
      createTask: vi.fn(),
      updateTask: vi.fn(),
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
      deleteTask: vi.fn()
    };
  });

  it('update 409 + changed field -> drops op and records a Conflict of kind "update"', async () => {
    const onConflict = vi.fn();
    const onTaskSaved = vi.fn();

    const op: OutboxOp = {
      id: 'op-u1',
      kind: 'update',
      taskId: 'task-1',
      patch: { content: 'Client change' },
      base: { content: 'Base content' },
      createdAt: '2026-09-30T14:00:00.000Z'
    };

    // First update call fails with 409
    (mockApi.updateTask as any).mockRejectedValueOnce(new ApiError(409, 'VERSION_CONFLICT', 'Conflict'));
    // getTask returns server version with DIFFERENT content
    const conflictServer = sampleTask({ id: 'task-1', version: 2, content: 'Server changed content' });
    (mockApi.getTask as any).mockResolvedValueOnce(conflictServer);

    const engine = createOutboxEngine({
      api: mockApi,
      storage,
      now,
      autoStart: false,
      onConflict,
      onTaskSaved
    });

    await engine.enqueue(op);
    await engine.flush();

    // Op was dropped from outbox
    expect(engine.pending()).toHaveLength(0);
    // Conflict was recorded
    expect(onConflict).toHaveBeenCalledTimes(1);
    const conflict: Conflict = onConflict.mock.calls[0]![0];
    expect(conflict.kind).toBe('update');
    expect(conflict.taskId).toBe('task-1');
    expect(conflict.server.version).toBe(2);
    expect(conflict.patch).toEqual({ content: 'Client change' });
    // Cache was replaced with server task
    expect(onTaskSaved).toHaveBeenCalledWith(conflictServer);
    // Conflict is in conflicts()
    expect(engine.conflicts()).toHaveLength(1);
  });

  it('complete 409 twice -> drops op and records a Conflict of kind "complete"', async () => {
    const onConflict = vi.fn();
    const op: OutboxOp = {
      id: 'op-c1',
      kind: 'complete',
      taskId: 'task-1',
      createdAt: '2026-09-30T14:00:00.000Z'
    };

    // 1st complete call -> 409
    (mockApi.completeTask as any).mockRejectedValueOnce(new ApiError(409, 'VERSION_CONFLICT', 'Conflict'));
    // getTask -> version 2
    const serverTask = sampleTask({ id: 'task-1', version: 2, content: 'Task 1' });
    (mockApi.getTask as any).mockResolvedValue(serverTask);
    // 2nd complete retry with version 2 -> 409 again
    (mockApi.completeTask as any).mockRejectedValueOnce(new ApiError(409, 'VERSION_CONFLICT', 'Conflict'));

    const engine = createOutboxEngine({
      api: mockApi,
      storage,
      now,
      autoStart: false,
      onConflict
    });

    await engine.enqueue(op);
    await engine.flush();

    expect(engine.pending()).toHaveLength(0);
    expect(onConflict).toHaveBeenCalledTimes(1);
    const conflict: Conflict = onConflict.mock.calls[0]![0];
    expect(conflict.kind).toBe('complete');
    expect(conflict.taskId).toBe('task-1');
    expect(conflict.patch).toBeNull();
  });

  it('delete 409 -> drops op and records a Conflict of kind "delete"', async () => {
    const onConflict = vi.fn();
    const op: OutboxOp = {
      id: 'op-d1',
      kind: 'delete',
      taskId: 'task-1',
      createdAt: '2026-09-30T14:00:00.000Z'
    };

    // delete call -> 409
    (mockApi.deleteTask as any).mockRejectedValueOnce(new ApiError(409, 'VERSION_CONFLICT', 'Conflict'));
    const serverTask = sampleTask({ id: 'task-1', version: 3, content: 'Deleted task title' });
    (mockApi.getTask as any).mockResolvedValueOnce(serverTask);

    const engine = createOutboxEngine({
      api: mockApi,
      storage,
      now,
      autoStart: false,
      onConflict
    });

    await engine.enqueue(op);
    await engine.flush();

    expect(engine.pending()).toHaveLength(0);
    expect(onConflict).toHaveBeenCalledTimes(1);
    const conflict: Conflict = onConflict.mock.calls[0]![0];
    expect(conflict.kind).toBe('delete');
    expect(conflict.title).toBe('Deleted task title');
    expect(conflict.server.version).toBe(3);
  });

  it('keeps the op on a network TypeError and marks offline', async () => {
    const op: OutboxOp = {
      id: 'op-1',
      kind: 'create',
      taskId: 'tmp-1',
      input: { content: 'Offline task' },
      createdAt: '2026-09-30T14:00:00.000Z'
    };

    (mockApi.createTask as any).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const engine = createOutboxEngine({
      api: mockApi,
      storage,
      now,
      autoStart: false
    });

    await engine.enqueue(op);
    await engine.flush();

    // Op is NOT dropped!
    expect(engine.pending()).toHaveLength(1);
    expect(engine.getStatus().online).toBe(false);
  });

  it('sets authRequired on 401, dropping nothing', async () => {
    const op: OutboxOp = {
      id: 'op-1',
      kind: 'complete',
      taskId: 'task-1',
      createdAt: '2026-09-30T14:00:00.000Z'
    };

    (mockApi.completeTask as any).mockRejectedValueOnce(new ApiError(401, 'UNAUTHORIZED', 'Unauthorized'));

    const engine = createOutboxEngine({
      api: mockApi,
      storage,
      now,
      autoStart: false
    });

    await engine.enqueue(op);
    await engine.flush();

    expect(engine.pending()).toHaveLength(1);
    expect(engine.getStatus().authRequired).toBe(true);
  });

  it('sets authRequired on a non-JSON response (ApiError with code AUTH), dropping nothing', async () => {
    const op: OutboxOp = {
      id: 'op-1',
      kind: 'delete',
      taskId: 'task-1',
      createdAt: '2026-09-30T14:00:00.000Z'
    };

    (mockApi.deleteTask as any).mockRejectedValueOnce(new ApiError(401, 'AUTH', 'Sessie verlopen'));

    const engine = createOutboxEngine({
      api: mockApi,
      storage,
      now,
      autoStart: false
    });

    await engine.enqueue(op);
    await engine.flush();

    expect(engine.pending()).toHaveLength(1);
    expect(engine.getStatus().authRequired).toBe(true);
  });

  it('drops the op and emits a removal on 404', async () => {
    const onTaskRemoved = vi.fn();
    const op: OutboxOp = {
      id: 'op-1',
      kind: 'update',
      taskId: 'task-999',
      patch: { content: 'Updated' },
      base: {},
      createdAt: '2026-09-30T14:00:00.000Z'
    };

    (mockApi.updateTask as any).mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'Task not found'));

    const engine = createOutboxEngine({
      api: mockApi,
      storage,
      now,
      autoStart: false,
      onTaskRemoved
    });

    await engine.enqueue(op);
    await engine.flush();

    expect(engine.pending()).toHaveLength(0);
    expect(onTaskRemoved).toHaveBeenCalledWith('task-999');
  });

  it('sends completed_on equal to the local date of the op\'s createdAt', async () => {
    const opCreatedAt = '2026-09-28T10:00:00.000Z';
    const op: OutboxOp = {
      id: 'op-c',
      kind: 'complete',
      taskId: 'task-1',
      createdAt: opCreatedAt
    };

    (mockApi.completeTask as any).mockResolvedValueOnce({
      task: sampleTask({ id: 'task-1', status: 'done' }),
      next: null
    });

    const engine = createOutboxEngine({
      api: mockApi,
      storage,
      now,
      autoStart: false
    });

    await engine.enqueue(op);
    await engine.flush();

    expect(mockApi.completeTask).toHaveBeenCalledWith('task-1', expect.any(Number), '2026-09-28');
  });

  it('returns referentially stable getStatus snapshot without state changes, and new object on change', async () => {
    const engine = createOutboxEngine({
      api: mockApi,
      storage,
      now,
      autoStart: false
    });

    const status1 = engine.getStatus();
    const status2 = engine.getStatus();
    expect(status1).toBe(status2);

    const op: OutboxOp = {
      id: 'op-status-1',
      kind: 'create',
      taskId: 'tmp-status-1',
      input: { content: 'New task' },
      createdAt: '2026-09-30T14:00:00.000Z'
    };

    await engine.enqueue(op);

    const status3 = engine.getStatus();
    expect(status3).not.toBe(status1);
    expect(status3.pending).toBe(1);

    const status4 = engine.getStatus();
    expect(status4).toBe(status3);
  });
});
