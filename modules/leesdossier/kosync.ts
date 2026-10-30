import { dedupeKey, type Book, type BookPatch } from './book.js';

/** Eén regel uit GET /syncs/documents van de KOReader-syncserver. */
export type KosyncDocument = {
  document: string;
  percentage: number;
  timestamp: number;
  device?: string | null;
  title?: string | null;
  authors?: string | null;
  filename?: string | null;
};

/** Titel zonder ondertitel ("Ghost in the Wires: My Adventures…" → "Ghost in the Wires"). */
const mainTitle = (t: string) => t.split(/\s*[:–—]\s+|\s+-\s+/)[0] ?? t;
const titleKey = (t: string) => dedupeKey(mainTitle(t));

/** Titels die een document kan hebben: metadata-titel, anders de bestandsnaam ("Titel - Auteur.epub"). */
function docTitles(doc: KosyncDocument): string[] {
  const out: string[] = [];
  if (doc.title?.trim()) out.push(doc.title.trim());
  if (doc.filename?.trim()) out.push(doc.filename.replace(/\.[a-z0-9]+$/i, '').split(' - ')[0]!.replace(/_/g, ':'));
  return out;
}

/**
 * Boek bij een KOReader-document: eerst een eerder vastgelegde koppeling, anders op (hoofd)titel.
 * Bij twijfel (meer dan één kandidaat) geen match, zodat er niets verkeerd wordt overschreven.
 */
export function matchBook(doc: KosyncDocument, books: Book[]): Book | undefined {
  const linked = books.find((b) => b.kosyncDocument === doc.document);
  if (linked) return linked;
  const keys = new Set(docTitles(doc).map(titleKey));
  const candidates = books.filter((b) => !b.kosyncDocument && keys.has(titleKey(b.title)));
  return candidates.length === 1 ? candidates[0] : undefined;
}

export const FINISHED_AT = 0.99;

/**
 * Wat een sync aan een boek verandert. Alleen nieuwere syncs tellen; een boek dat uit of gestaakt is
 * wordt nooit automatisch teruggezet (alleen de koppeling wordt bijgewerkt).
 */
export function syncPatch(book: Book, doc: KosyncDocument, dateOf: (unixSeconds: number) => string): BookPatch | null {
  if (book.kosyncAt !== null && doc.timestamp <= book.kosyncAt && book.kosyncDocument === doc.document) return null;
  const day = dateOf(doc.timestamp);
  const patch: BookPatch = { kosyncDocument: doc.document, kosyncAt: doc.timestamp };
  if (book.status === 'uit' || book.status === 'gestaakt') return patch;

  const progress = Math.max(0, Math.min(100, Math.round(doc.percentage * 100)));
  if (doc.percentage >= FINISHED_AT) {
    return { ...patch, status: 'uit', progress: 100, order: 0, doneAt: day, updated: day, ...(book.started ? {} : { started: day }) };
  }
  if (progress !== book.progress) Object.assign(patch, { progress, updated: day });
  if (book.status === 'te-lezen' && progress > 0) {
    Object.assign(patch, { status: 'lezend', order: 0, updated: day, ...(book.started ? {} : { started: day }) });
  }
  return patch;
}

/** Auteurs uit KOReader ("A; B") als leesbare tekst. */
export const authorsText = (authors?: string | null) => (authors ?? '').split(/\s*;\s*/).filter(Boolean).join(', ');
