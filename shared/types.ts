export type Visibility = 'personal' | 'work' | 'shared';

export type TaskStatus =
  | 'inbox'
  | 'next'
  | 'active'
  | 'waiting'
  | 'scheduled'
  | 'someday'
  | 'done'
  | 'archived';

export type ChecklistItem = { id: string; text: string; done: boolean };

export type RecurrenceRule =
  | { type: 'daily'; interval: number }
  | { type: 'weekly'; interval: number; weekdays: number[] }
  | { type: 'monthly'; interval: number; day: number }
  | { type: 'after_completion'; every: number; unit: 'day' | 'week' };

export type Task = {
  id: string;
  version: number;
  content: string;
  status: TaskStatus;
  visibility: Visibility;
  tags: string[];
  metadata: TaskMetadata;
  createdAt: string;
  updatedAt: string;
};

/** Velden die deze app in Postgram-metadata gebruikt. Overige keys blijven onaangeroerd. */
export type TaskMetadata = {
  context?: string | null;
  due_date?: string | null;
  start_date?: string | null;
  evening?: boolean | null;
  checklist?: ChecklistItem[] | null;
  project_id?: string | null;
  sort_order?: number | null;
  completed_at?: string | null;
  recurrence?: RecurrenceRule | null;
  recurrence_parent_id?: string | null;
  recurrence_next_id?: string | null;
  reminder_time?: string | null;
  [key: string]: unknown;
};

export type Project = {
  id: string;
  version: number;
  content: string;
  status: string | null;
  visibility: Visibility;
  tags: string[];
  metadata: Record<string, unknown>;
};

export type LinkedEntity = {
  edgeId: string;
  relation: string;
  direction: 'outgoing' | 'incoming';
  entity: { id: string; type: string; content: string; tags: string[] } | null;
};

export type SearchHit = { id: string; type: string; content: string; score: number };
