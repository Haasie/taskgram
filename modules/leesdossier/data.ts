import { useQuery } from '@tanstack/react-query';
import { ApiError, request } from '../../src/lib/api';
import { queryClient } from '../../src/lib/queries';
import { enqueue } from '../../src/lib/serial';
import { showToast } from '../../src/lib/toast';
import type { Book, BookPatch } from './book';
import type { KosyncDocument } from './kosync';

// Alleen in het geheugen: boekdata komt altijd uit Postgram (niet in de offline cache, zie persist.ts).
const KEY = ['module', 'leesdossier', 'books'] as const;
const BASE = '/modules/leesdossier/books';

export const useBooks = () =>
  useQuery({
    queryKey: KEY,
    queryFn: async () => {
      try {
        return (await request<{ items: Book[] }>('GET', BASE)).items;
      } catch (err) {
        // Elders uitgezet: de server weigert; dan de schakelaars opnieuw ophalen zodat de route verdwijnt.
        if (err instanceof ApiError && err.code === 'MODULE_DISABLED') void queryClient.invalidateQueries({ queryKey: ['modules'] });
        throw err;
      }
    },
    retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 1
  });

const getBooks = () => queryClient.getQueryData<Book[]>(KEY) ?? [];
const setBooks = (fn: (books: Book[]) => Book[]) => queryClient.setQueryData<Book[]>(KEY, (old) => fn(old ?? []));
const replace = (book: Book) => setBooks((books) => books.map((b) => (b.id === book.id ? book : b)));

function failed(what: string, err: unknown) {
  if (err instanceof ApiError && err.status === 409) showToast('Boek is elders gewijzigd; opnieuw geladen.');
  else showToast(`${what} mislukt: ${err instanceof Error ? err.message : ''}`);
  void queryClient.invalidateQueries({ queryKey: KEY });
}

/** Direct zichtbaar, daarna per boek op volgorde naar Postgram (met versiecontrole). */
export function updateBook(id: string, patch: BookPatch) {
  setBooks((books) => books.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  return enqueue('book:' + id, async () => {
    const version = getBooks().find((b) => b.id === id)?.version;
    if (version === undefined) return;
    try {
      const res = await request<{ book: Book }>('PATCH', `${BASE}/${id}`, { version, ...patch });
      replace(res.book);
    } catch (err) {
      failed('Opslaan', err);
    }
  });
}

export async function createBook(fields: BookPatch & { title: string }) {
  try {
    const res = await request<{ book: Book }>('POST', BASE, fields);
    setBooks((books) => [...books, res.book]);
    return res.book;
  } catch (err) {
    failed('Toevoegen', err);
    return null;
  }
}

export async function deleteBook(id: string) {
  setBooks((books) => books.filter((b) => b.id !== id));
  try {
    await request('DELETE', `${BASE}/${id}`);
  } catch (err) {
    failed('Verwijderen', err);
  }
}

// --- KOReader-sync ---

export type KosyncStatus = {
  configured: boolean;
  last: { at: string; ok: boolean; error?: string; documents: number; updated: string[]; unmatched: KosyncDocument[] } | null;
};
const KOSYNC_KEY = ['module', 'leesdossier', 'kosync'] as const;

export const useKosync = () =>
  useQuery({ queryKey: KOSYNC_KEY, queryFn: () => request<KosyncStatus>('GET', '/modules/leesdossier/kosync'), refetchInterval: 5 * 60_000 });

export async function syncKosync() {
  try {
    const { last } = await request<{ last: KosyncStatus['last'] }>('POST', '/modules/leesdossier/kosync/sync');
    queryClient.setQueryData<KosyncStatus>(KOSYNC_KEY, (old) => ({ configured: true, ...old, last }));
    if (last && !last.ok) showToast(`KOReader-sync mislukt: ${last.error ?? ''}`);
  } catch (err) {
    showToast(`KOReader-sync mislukt: ${err instanceof Error ? err.message : ''}`);
  }
  void queryClient.invalidateQueries({ queryKey: KEY });
}

export async function adoptKosync(doc: KosyncDocument, cat: string) {
  try {
    const { book } = await request<{ book: Book }>('POST', `/modules/leesdossier/kosync/adopt/${encodeURIComponent(doc.document)}`, { cat });
    setBooks((books) => [...books, book]);
    queryClient.setQueryData<KosyncStatus>(KOSYNC_KEY, (old) =>
      old?.last ? { ...old, last: { ...old.last, unmatched: old.last.unmatched.filter((d) => d.document !== doc.document) } } : old
    );
  } catch (err) {
    failed('Toevoegen', err);
  }
}
