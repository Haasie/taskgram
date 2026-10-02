import { describe, expect, it } from 'vitest';
import type { Project, Task } from '../../shared/types.js';
import { dropPatch } from './dnd';

const task = (partial: Partial<Task> & { metadata?: Task['metadata'] } = {}): Task => ({
  id: 't1',
  version: 1,
  content: 'Taak',
  status: 'next',
  visibility: 'personal',
  tags: [],
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  ...partial,
  metadata: partial.metadata ?? {}
});

describe('dropPatch', () => {
  const projectsById = new Map<string, Project>();

  it('inbox task dropped on area:work yields status: next, visibility: work, metadata.project_id: null', () => {
    const t = task({ status: 'inbox' });
    const patch = dropPatch(t, 'area:work', projectsById);
    expect(patch).toEqual({
      status: 'next',
      visibility: 'work',
      metadata: { start_date: null, evening: false, project_id: null }
    });
  });

  it('a next task dropped on area:work has no status key', () => {
    const t = task({ status: 'next' });
    const patch = dropPatch(t, 'area:work', projectsById);
    expect(patch).toEqual({
      visibility: 'work',
      metadata: { project_id: null }
    });
    expect((patch as any).status).toBeUndefined();
  });

  it("logbook -> 'complete'", () => {
    const t = task();
    expect(dropPatch(t, 'logbook', projectsById)).toBe('complete');
  });
});
