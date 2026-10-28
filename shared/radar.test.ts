import { describe, expect, it } from 'vitest';
import type { Project, Task } from './types.js';
import { countsByProject, daysLeft, isRadarProject, radarMeta, radarProjects, radarSummary, radarTitle, rankRadar } from './radar.js';

const project = (id: string, tags: string[], metadata: Record<string, unknown>, visibility: Project['visibility'] = 'work', status: string | null = 'active'): Project => ({
  id,
  version: 1,
  content: `${id}\n\nbeschrijving`,
  status,
  visibility,
  tags,
  metadata
});

const task = (id: string, status: Task['status'], visibility: Task['visibility'], metadata: Task['metadata'] = {}, createdAt = '2026-10-27T10:00:00Z'): Task => ({
  id,
  version: 1,
  content: id,
  status,
  visibility,
  tags: [],
  metadata,
  createdAt,
  updatedAt: createdAt
});

describe('radarMeta', () => {
  it('leest de radarvelden en negeert ongeldige waarden', () => {
    const m = radarMeta(project('p', ['werkradar'], { code: 'P01', naam: 'ANKER', rag: 'paars', deadline: '2026-10-31T00:00:00Z', sort: '3' }));
    expect(m).toMatchObject({ code: 'P01', naam: 'ANKER', rag: null, deadline: '2026-10-31', sort: 3 });
  });
});

describe('isRadarProject', () => {
  it('herkent de tag per gebied en sluit afgeronde projecten uit', () => {
    expect(isRadarProject(project('a', ['werkradar'], {}), 'work')).toBe(true);
    expect(isRadarProject(project('a', ['werkradar'], {}), 'personal')).toBe(false);
    expect(isRadarProject(project('b', ['priveradar'], {}, 'personal'), 'personal')).toBe(true);
    expect(isRadarProject(project('c', ['werkradar'], {}, 'work', 'done'))).toBe(false);
    expect(isRadarProject(project('d', ['iets'], {}))).toBe(false);
  });
});

describe('rankRadar', () => {
  it('zet deadline eerst, dan rood/oranje/groen, dan sort', () => {
    const list = [
      project('groen', ['werkradar'], { code: 'P03', rag: 'groen', sort: 3 }),
      project('rood', ['werkradar'], { code: 'P02', rag: 'rood', sort: 2 }),
      project('later', ['werkradar'], { code: 'P04', rag: 'groen', deadline: '2026-12-18', sort: 4 }),
      project('eerst', ['werkradar'], { code: 'P05', rag: 'rood', deadline: '2026-10-31', sort: 5 }),
      project('oranje', ['werkradar'], { code: 'P01', rag: 'oranje', sort: 1 })
    ];
    expect(rankRadar(list).map((p) => p.id)).toEqual(['eerst', 'later', 'rood', 'oranje', 'groen']);
  });
});

describe('countsByProject en radarSummary', () => {
  const projects = [project('p1', ['werkradar'], { code: 'P01' }), project('v1', ['priveradar'], { code: 'V01' }, 'personal')];
  const tasks = [
    task('a', 'next', 'work', { project_id: 'p1' }),
    task('b', 'inbox', 'work', { project_id: 'p1' }, '2026-08-01T10:00:00Z'),
    task('c', 'inbox', 'work', {}, '2026-10-20T10:00:00Z'),
    task('d', 'someday', 'work', { project_id: 'p1' }),
    task('e', 'done', 'work', { project_id: 'p1' }),
    task('f', 'next', 'personal', { project_id: 'v1' }),
    task('g', 'next', 'work', { project_id: 'onbekend' })
  ];

  it('telt open taken per project per status', () => {
    const c = countsByProject(tasks).get('p1')!;
    expect(c).toMatchObject({ next: 1, inbox: 1, someday: 1, open: 2, total: 3 });
  });

  it('vat een gebied samen met niet-ingedeeld en verouderde inbox', () => {
    const s = radarSummary(tasks, projects, 'work', '2026-10-28');
    expect(s).toMatchObject({ next: 2, inbox: 2, someday: 1, unassigned: 2, stale: 1 });
    expect(radarProjects(projects, 'work').map((p) => p.id)).toEqual(['p1']);
  });
});

describe('daysLeft en radarTitle', () => {
  it('rekent dagen tot de deadline', () => {
    expect(daysLeft('2026-10-31', '2026-10-28')).toBe(3);
    expect(daysLeft('2026-10-27', '2026-10-28')).toBe(-1);
    expect(daysLeft(null, '2026-10-28')).toBeNull();
  });
  it('bouwt de titel uit code en naam', () => {
    expect(radarTitle(project('x', ['werkradar'], { code: 'P01', naam: 'ANKER' }), () => 'fallback')).toBe('P01 ANKER');
    expect(radarTitle(project('x', ['werkradar'], {}), () => 'fallback')).toBe('fallback');
  });
});
