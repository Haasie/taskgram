import type { Project, Task, Visibility } from '../../shared/types.js';
import type { TaskPatch } from './api';
import { whenPatch } from './when';

export function dropPatch(
  task: Task,
  target: string,
  projectsById: Map<string, Project>
): TaskPatch | 'complete' | 'pick-date' | null {
  if (target.startsWith('project:')) {
    const projectId = target.slice(8);
    const project = projectsById.get(projectId);
    const patch = task.status === 'inbox' ? whenPatch({ kind: 'anytime' }) : {};
    return {
      ...patch,
      visibility: project?.visibility,
      metadata: { ...patch.metadata, project_id: projectId }
    };
  }
  if (target.startsWith('area:')) {
    const area = target.slice(5) as Visibility;
    const patch = task.status === 'inbox' ? whenPatch({ kind: 'anytime' }) : {};
    return { ...patch, visibility: area, metadata: { ...patch.metadata, project_id: null } };
  }
  if (target === 'logbook') return 'complete';
  if (target === 'upcoming') return 'pick-date';

  if (target === 'today') return whenPatch({ kind: 'today' });
  if (target === 'anytime') return whenPatch({ kind: 'anytime' });
  if (target === 'someday') return whenPatch({ kind: 'someday' });
  if (target === 'inbox') return whenPatch({ kind: 'inbox' });
  if (target === 'waiting') return whenPatch({ kind: 'waiting' });

  return null;
}
