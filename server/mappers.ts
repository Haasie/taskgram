import type { Project, Task, TaskStatus } from '../shared/types.js';
import type { RawEntity } from './postgram.js';

export function toTask(raw: RawEntity): Task {
  return {
    id: raw.id,
    version: raw.version,
    content: raw.content ?? '',
    status: (raw.status ?? 'inbox') as TaskStatus,
    visibility: raw.visibility,
    tags: raw.tags ?? [],
    metadata: raw.metadata ?? {},
    createdAt: raw.created_at,
    updatedAt: raw.updated_at
  };
}

export function toProject(raw: RawEntity): Project {
  return {
    id: raw.id,
    version: raw.version,
    content: raw.content ?? '',
    status: raw.status,
    visibility: raw.visibility,
    tags: raw.tags ?? [],
    metadata: raw.metadata ?? {}
  };
}

export function truncate(text: string | null, max = 280) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
