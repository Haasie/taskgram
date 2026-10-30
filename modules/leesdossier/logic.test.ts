import { describe, expect, it } from 'vitest';
import { bookContent, bookFromEntity, bookMetadata, dedupeKey, type Book } from './book';
import { counts, exportMarkdown, matches, quarterOf, sections, statusPatch, swapInQueue } from './logic';

const book = (over: Partial<Book>): Book => ({
  ...bookFromEntity({ id: over.id ?? over.title ?? 'x', version: 1, metadata: {} }),
  ...over
});

const library = [
  book({ id: 'g', title: 'Ghost in the Wires', author: 'Kevin Mitnick', status: 'lezend', cat: 'sec', progress: 40 }),
  book({ id: 'n', title: 'The Nord Stream Conspiracy', author: 'Pancevski', cat: 'pol', order: 1 }),
  book({ id: 'p', title: 'Paris', author: 'Bert Wagendorp', cat: 'fic', order: 3 }),
  book({ id: 'z', title: 'Zuid', author: 'Ernest Shackleton', cat: 'reis' }),
  book({ id: 'b', title: 'Borne', author: 'Jeff VanderMeer', cat: 'fic' }),
  book({ id: 'k', title: 'The Kite Runner', author: 'Khaled Hosseini', status: 'uit', cat: 'fic', rating: 4, doneAt: '2026-10-02' }),
  book({ id: 'o', title: 'The Obstacle Is the Way', author: 'Ryan Holiday', status: 'uit', cat: 'fil', doneAt: '2026-05-01' })
];

describe('leesdossier', () => {
  it('telt per kwartaal op doneAt', () => {
    expect(quarterOf('2026-10-29')).toBe('2026-Q4');
    expect(counts(library, '2026-10-29')).toMatchObject({ reading: 1, queue: 2, backlog: 2, done: 2, doneThisQuarter: 1 });
  });

  it('verdeelt in secties; wachtrij op volgorde, backlog per categorie', () => {
    const s = sections(library);
    expect(s.queue.map((b) => b.id)).toEqual(['n', 'p']);
    expect(s.backlog.map((b) => b.id)).toEqual(['b', 'z']);
    expect(s.done.map((b) => b.id)).toEqual(['k', 'o']);
    expect(s.stopped).toEqual([]);
  });

  it('filtert op zoekterm en categorie', () => {
    expect(library.filter((b) => matches(b, 'mitnick', '')).map((b) => b.id)).toEqual(['g']);
    expect(library.filter((b) => matches(b, '', 'fic')).length).toBe(3);
  });

  it('zet velden mee bij een statuswissel', () => {
    const queued = library[1]!;
    expect(statusPatch(queued, 'lezend', '2026-10-29')).toEqual({ status: 'lezend', updated: '2026-10-29', order: 0, started: '2026-10-29' });
    expect(statusPatch(library[0]!, 'uit', '2026-10-29')).toMatchObject({ progress: 100, doneAt: '2026-10-29', order: 0 });
  });

  it('wisselt buren in de wachtrij en stopt aan de rand', () => {
    expect(swapInQueue(library, 'n', -1)).toBeNull();
    const swap = swapInQueue(library, 'n', 1)!;
    expect([swap[0].id, swap[1], swap[2].id, swap[3]]).toEqual(['n', { order: 3 }, 'p', { order: 1 }]);
  });

  it('exporteert Markdown met wikilinks, nummering en sterren', () => {
    expect(exportMarkdown(library)).toBe(
      [
        '## Nu lezend',
        '- [[Ghost in the Wires]] — Kevin Mitnick',
        '',
        '## Volgende',
        '1. [[The Nord Stream Conspiracy]] — Pancevski',
        '2. [[Paris]] — Bert Wagendorp',
        '',
        '## Backlog',
        '',
        '### Fictie',
        '- [[Borne]] — Jeff VanderMeer',
        '',
        '### Reizen & Cultuur',
        '- [[Zuid]] — Ernest Shackleton',
        '',
        '## Uitgelezen',
        '- [[The Kite Runner]] — Khaled Hosseini — ★★★★☆',
        '- [[The Obstacle Is the Way]] — Ryan Holiday',
        ''
      ].join('\n')
    );
  });

  it('linkt naar de vault-note met alias als de bestandsnaam afwijkt', () => {
    const md = exportMarkdown([
      book({ title: 'Human Hacking', author: 'Christopher Hadnagy', status: 'uit', vaultPath: '30 Kennis/38 Objects/Books/Human Hacking EPB.md' }),
      book({ title: 'Borne', status: 'lezend', vaultPath: '30 Kennis/38 Objects/Books/Borne.md' })
    ]);
    expect(md).toContain('- [[Human Hacking EPB|Human Hacking]] — Christopher Hadnagy');
    expect(md).toContain('- [[Borne]]');
  });

  it('mapt metadata heen en terug; lege tekst wordt null', () => {
    expect(bookMetadata({ author: '', doneAt: '2026-01-02', vaultPath: 'a.md' })).toEqual({ author: null, done_at: '2026-01-02', vault_path: 'a.md' });
    const b = bookFromEntity({ id: '1', version: 2, metadata: { title: 'T', status: 'raar', cat: 'x', rating: 9, done_at: '2026-01-02' } });
    expect(b).toMatchObject({ status: 'te-lezen', cat: 'ov', rating: 5, doneAt: '2026-01-02' });
    expect(bookContent({ title: 'T', author: 'A', note: '' })).toBe('T — A');
  });

  it('herkent dubbelen ongeacht hoofdletters, leestekens en lidwoord', () => {
    expect(dedupeKey('Ghost In The Wires', 'Kevin Mitnick')).toBe(dedupeKey('ghost in the wires', 'kevin mitnick'));
    expect(dedupeKey('The Goal: A Process', '')).toBe(dedupeKey('Goal - a process'));
  });
});
