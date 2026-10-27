import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from './quickAdd';

const today = '2026-09-30'; // woensdag
const projects = [
  { id: 'p1', title: 'Verbouwing' },
  { id: 'p2', title: 'Werk planning' }
];
const parse = (s: string) => parseQuickAdd(s, { today, projects });

describe('parseQuickAdd', () => {
  it('leaves plain titles alone', () => {
    expect(parse('Boodschappen doen')).toEqual({ title: 'Boodschappen doen', tags: [], projectId: null, priority: null, when: null, due: null });
  });

  it('extracts labels, including quoted ones', () => {
    const r = parse('Bel *thuis de loodgieter *"heel dringend"');
    expect(r.title).toBe('Bel de loodgieter');
    expect(r.tags).toEqual(['thuis', 'heel dringend']);
  });

  it('matches projects by name or prefix and keeps unknown ones in the title', () => {
    expect(parse('Tegels kiezen +verbouw').projectId).toBe('p1');
    expect(parse('Agenda +planning').projectId).toBe('p2');
    expect(parse('Agenda +"Werk planning"').projectId).toBe('p2');
    const unknown = parse('Iets +onbekend');
    expect(unknown.projectId).toBeNull();
    expect(unknown.title).toBe('Iets +onbekend');
  });

  it('extracts priority', () => {
    const r = parse('Server patchen !4');
    expect(r.priority).toBe(4);
    expect(r.title).toBe('Server patchen');
    expect(parse('Hallo!3').priority).toBeNull();
  });

  it('parses when-words in Dutch and English', () => {
    expect(parse('Sporten vandaag').when).toEqual({ kind: 'today' });
    expect(parse('Pizza tonight').when).toEqual({ kind: 'evening' });
    expect(parse('Bel terug morgen')).toMatchObject({ title: 'Bel terug', when: { kind: 'date', date: '2026-10-01' } });
    expect(parse('Boek lezen ooit').when).toEqual({ kind: 'someday' });
    expect(parse('Overleg vrijdag').when).toEqual({ kind: 'date', date: '2026-10-02' });
    expect(parse('Overleg woensdag').when).toEqual({ kind: 'date', date: '2026-10-07' });
    expect(parse('Release 2026-11-03').when).toEqual({ kind: 'date', date: '2026-11-03' });
    expect(parse('Plannen volgende week').when).toEqual({ kind: 'date', date: '2026-10-07' });
  });

  it('only treats date words at the end as dates', () => {
    expect(parse('Nieuwe vandaag taak')).toMatchObject({ title: 'Nieuwe vandaag taak', when: null });
    expect(parse('Cadeau voor mama')).toMatchObject({ title: 'Cadeau voor mama', due: null });
    expect(parse('Morgen-overleg voorbereiden').when).toBeNull();
  });

  it('parses deadlines separately from the start date', () => {
    const r = parse('Belastingaangifte deadline vrijdag morgen');
    expect(r.due).toBe('2026-10-02');
    expect(r.when).toEqual({ kind: 'date', date: '2026-10-01' });
    expect(r.title).toBe('Belastingaangifte');
    expect(parse('Rapport due 2026-10-15').due).toBe('2026-10-15');
  });

  it('combines everything', () => {
    const r = parse('Offerte sturen +verbouwing *mail !3 morgen');
    expect(r).toMatchObject({ title: 'Offerte sturen', projectId: 'p1', tags: ['mail'], priority: 3, when: { kind: 'date', date: '2026-10-01' } });
  });
});
