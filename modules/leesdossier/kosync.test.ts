import { describe, expect, it } from 'vitest';
import { bookFromEntity, type Book } from './book';
import { authorsText, matchBook, syncPatch, type KosyncDocument } from './kosync';

const book = (over: Partial<Book>): Book => ({ ...bookFromEntity({ id: over.title ?? 'x', version: 1, metadata: {} }), ...over });
const dateOf = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);

const ghostDoc: KosyncDocument = {
  document: 'd6abb38b',
  percentage: 0.54,
  timestamp: Date.UTC(2026, 9, 28, 23, 52) / 1000,
  device: 'PBTouchHDPlus',
  title: 'Ghost in the Wires: My Adventures as the World’s Most Wanted Hacker',
  authors: 'Kevin; Steve Wozniak; William L. Simon Mitnick',
  filename: "Ghost in the Wires_ My Adventures as the World's Most Wanted Hacker - Kevin Mitnick.epub"
};

describe('kosync', () => {
  const ghost = book({ id: 'g', title: 'Ghost in the Wires', author: 'Kevin Mitnick', status: 'lezend', progress: 0 });

  it('koppelt op hoofdtitel, en daarna op de vastgelegde document-hash', () => {
    expect(matchBook(ghostDoc, [ghost, book({ title: 'Borne' })])?.id).toBe('g');
    const linked = book({ id: 'l', title: 'Andere titel', kosyncDocument: 'd6abb38b' });
    expect(matchBook(ghostDoc, [ghost, linked])?.id).toBe('l');
  });

  it('valt terug op de bestandsnaam en weigert bij twijfel', () => {
    expect(matchBook({ ...ghostDoc, title: null }, [ghost])?.id).toBe('g');
    expect(matchBook(ghostDoc, [ghost, book({ id: 'g2', title: 'Ghost in the wires' })])).toBeUndefined();
    expect(matchBook({ ...ghostDoc, title: 'Iets anders', filename: null }, [ghost])).toBeUndefined();
  });

  it('zet voortgang en koppeling; te-lezen wordt lezend met startdatum', () => {
    expect(syncPatch(ghost, ghostDoc, dateOf)).toEqual({ kosyncDocument: 'd6abb38b', kosyncAt: ghostDoc.timestamp, progress: 54, updated: '2026-10-28' });
    const queued = book({ title: 'Ghost in the Wires', status: 'te-lezen', order: 2 });
    expect(syncPatch(queued, ghostDoc, dateOf)).toMatchObject({ status: 'lezend', order: 0, started: '2026-10-28', progress: 54 });
  });

  it('vanaf 99% uit met einddatum; uit en gestaakt worden niet teruggezet; oude syncs genegeerd', () => {
    expect(syncPatch(ghost, { ...ghostDoc, percentage: 0.995 }, dateOf)).toMatchObject({ status: 'uit', progress: 100, doneAt: '2026-10-28' });
    expect(syncPatch(book({ status: 'gestaakt', progress: 18 }), ghostDoc, dateOf)).toEqual({ kosyncDocument: 'd6abb38b', kosyncAt: ghostDoc.timestamp });
    const synced = { ...ghost, kosyncDocument: 'd6abb38b', kosyncAt: ghostDoc.timestamp };
    expect(syncPatch(synced, ghostDoc, dateOf)).toBeNull();
  });

  it('maakt auteurs leesbaar', () => {
    expect(authorsText('Kevin; Steve Wozniak')).toBe('Kevin, Steve Wozniak');
    expect(authorsText(null)).toBe('');
  });
});
