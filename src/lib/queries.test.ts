import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Project, Task } from '../../shared/types.js';

const mockUpdateProject = vi.fn();
const mockCompleteTask = vi.fn();
const mockReopenTask = vi.fn();

vi.mock('./api', () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) {
      super(message);
    }
  },
  api: {
    updateProject: (...args: any[]) => mockUpdateProject(...args),
    completeTask: (...args: any[]) => mockCompleteTask(...args),
    reopenTask: (...args: any[]) => mockReopenTask(...args)
  }
}));

import { completeTask, queryClient, reopenTask, updateProject } from './queries';

describe('updateProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it('two back-to-back updateProject calls -> the second API call receives version 2', async () => {
    const initialProject: Project = {
      id: 'p1',
      version: 1,
      content: 'Project 1',
      status: 'active',
      tags: [],
      visibility: 'personal',
      metadata: {}
    };

    queryClient.setQueryData<Project[]>(['projects'], [initialProject]);

    mockUpdateProject.mockImplementation(async (_id: string, version: number, patch: any) => {
      await new Promise((r) => setTimeout(r, 10));
      return {
        ...initialProject,
        ...patch,
        version: version + 1
      };
    });

    const p1 = updateProject('p1', { content: 'Updated 1' });
    const p2 = updateProject('p1', { content: 'Updated 2' });

    await Promise.all([p1, p2]);

    expect(mockUpdateProject).toHaveBeenCalledTimes(2);
    expect(mockUpdateProject).toHaveBeenNthCalledWith(1, 'p1', 1, { content: 'Updated 1' });
    expect(mockUpdateProject).toHaveBeenNthCalledWith(2, 'p1', 2, { content: 'Updated 2' });
  });
});

describe('H2 regression: completeTask then reopenTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it('after completeTask resolves with version 2, reopenTask(id) calls the API with version 2', async () => {
    const initialTask: Task = {
      id: 't1',
      version: 1,
      content: 'Task 1',
      status: 'next',
      tags: [],
      visibility: 'personal',
      metadata: {},
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z'
    };

    queryClient.setQueryData<Task[]>(['tasks'], [initialTask]);

    mockCompleteTask.mockResolvedValue({
      task: { ...initialTask, status: 'done', version: 2 },
      next: null
    });
    mockReopenTask.mockResolvedValue({
      task: { ...initialTask, status: 'next', version: 3 },
      removedNextId: null
    });

    await completeTask(initialTask);
    expect(mockCompleteTask).toHaveBeenCalledWith('t1', 1, expect.any(String));

    await reopenTask(initialTask.id);
    expect(mockReopenTask).toHaveBeenCalledWith('t1', 2);
  });
});
