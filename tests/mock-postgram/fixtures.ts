import type { RawEntity, RawEdge } from '../../server/postgram.js';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function localDateString(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y!, m! - 1, d!);
  date.setDate(date.getDate() + days);
  return localDateString(date);
}

export const FIXTURE_IDS = {
  INBOX_TASK_1: '11111111-1111-4111-8111-111111111111',
  INBOX_TASK_2: '22222222-2222-4222-8222-222222222222',
  INBOX_TASK_3: '33333333-3333-4333-8333-333333333333',
  OVERDUE_TASK: '44444444-4444-4444-8444-444444444444',
  WAITING_TASK: '55555555-5555-4555-8555-555555555555',
  PROJECT_1: '66666666-6666-4666-8666-666666666666',
  PROJECT_TASK_1: '77777777-7777-4777-8777-777777777777',
  EDGE_PROJECT_1: '88888888-8888-4888-8888-888888888888'
};

export function createFixtures(): { entities: RawEntity[]; edges: RawEdge[] } {
  const today = localDateString();
  const now = new Date().toISOString();

  const entities: RawEntity[] = [
    {
      id: FIXTURE_IDS.INBOX_TASK_1,
      type: 'task',
      content: 'Inbox taak 1',
      status: 'inbox',
      visibility: 'personal',
      version: 1,
      tags: [],
      metadata: {},
      created_at: now,
      updated_at: now
    },
    {
      id: FIXTURE_IDS.INBOX_TASK_2,
      type: 'task',
      content: 'Inbox taak 2',
      status: 'inbox',
      visibility: 'personal',
      version: 1,
      tags: [],
      metadata: {},
      created_at: now,
      updated_at: now
    },
    {
      id: FIXTURE_IDS.INBOX_TASK_3,
      type: 'task',
      content: 'Inbox taak 3',
      status: 'inbox',
      visibility: 'personal',
      version: 1,
      tags: [],
      metadata: {},
      created_at: now,
      updated_at: now
    },
    {
      id: FIXTURE_IDS.OVERDUE_TASK,
      type: 'task',
      content: 'Achterstallige taak',
      status: 'next',
      visibility: 'personal',
      version: 1,
      tags: [],
      metadata: {
        due_date: addDays(today, -3)
      },
      created_at: now,
      updated_at: now
    },
    {
      id: FIXTURE_IDS.WAITING_TASK,
      type: 'task',
      content: 'Wachtende taak',
      status: 'waiting',
      visibility: 'personal',
      version: 1,
      tags: [],
      metadata: {
        context: 'Wachten op antwoord'
      },
      created_at: now,
      updated_at: now
    },
    {
      id: FIXTURE_IDS.PROJECT_1,
      type: 'project',
      content: 'Project Alfa',
      status: 'active',
      visibility: 'personal',
      version: 1,
      tags: [],
      metadata: {},
      created_at: now,
      updated_at: now
    },
    {
      id: FIXTURE_IDS.PROJECT_TASK_1,
      type: 'task',
      content: 'Project taak 1',
      status: 'next',
      visibility: 'personal',
      version: 1,
      tags: [],
      metadata: {
        project_id: FIXTURE_IDS.PROJECT_1
      },
      created_at: now,
      updated_at: now
    }
  ];

  const edges: RawEdge[] = [
    {
      id: FIXTURE_IDS.EDGE_PROJECT_1,
      source_id: FIXTURE_IDS.PROJECT_TASK_1,
      target_id: FIXTURE_IDS.PROJECT_1,
      relation: 'part_of'
    }
  ];

  return { entities, edges };
}
