import { CATEGORIES, categoryName, type Book, type BookPatch, type BookStatus, type Category } from './book.js';

export const QUARTER_GOAL = 4;

export const isQueued = (b: Book) => b.status === 'te-lezen' && b.order > 0;
export const isBacklog = (b: Book) => b.status === 'te-lezen' && b.order <= 0;

export function quarterOf(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number);
  return `${y}-Q${Math.floor(((m ?? 1) - 1) / 3) + 1}`;
}

export function counts(books: Book[], today: string) {
  const q = quarterOf(today);
  return {
    reading: books.filter((b) => b.status === 'lezend').length,
    queue: books.filter(isQueued).length,
    backlog: books.filter(isBacklog).length,
    done: books.filter((b) => b.status === 'uit').length,
    quarter: q,
    doneThisQuarter: books.filter((b) => b.status === 'uit' && b.doneAt && quarterOf(b.doneAt) === q).length
  };
}

export function matches(b: Book, query: string, cat: Category | ''): boolean {
  if (cat && b.cat !== cat) return false;
  if (!query) return true;
  return `${b.title} ${b.author} ${b.note} ${b.src}`.toLowerCase().includes(query.toLowerCase());
}

const byTitle = (a: Book, b: Book) => a.title.localeCompare(b.title, 'nl');

export function sections(books: Book[]) {
  const of = (s: BookStatus) => books.filter((b) => b.status === s);
  return {
    reading: of('lezend').sort(byTitle),
    queue: books.filter(isQueued).sort((a, b) => a.order - b.order),
    backlog: books
      .filter(isBacklog)
      .sort((a, b) => categoryName(a.cat).localeCompare(categoryName(b.cat), 'nl') || byTitle(a, b)),
    done: of('uit').sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '') || byTitle(a, b)),
    stopped: of('gestaakt').sort(byTitle)
  };
}

export const maxOrder = (books: Book[]) => books.reduce((m, b) => Math.max(m, isQueued(b) ? b.order : 0), 0);

/** Statuswissel met de bijbehorende velden (wachtrij leeg, voortgang, start- en einddatum). */
export function statusPatch(b: Book, status: BookStatus, today: string): BookPatch {
  const p: BookPatch = { status, updated: today };
  if (status === 'lezend') {
    p.order = 0;
    if (!b.started) p.started = today;
  }
  if (status === 'uit') {
    p.order = 0;
    p.progress = 100;
    if (b.status !== 'uit') p.doneAt = today;
  }
  if (status === 'te-lezen' && b.status !== 'te-lezen') p.order = 0;
  return p;
}

/** Plek wisselen met de buur in de wachtrij; geeft de twee patches terug of null aan de rand. */
export function swapInQueue(books: Book[], id: string, dir: -1 | 1): [Book, BookPatch, Book, BookPatch] | null {
  const queue = books.filter(isQueued).sort((a, b) => a.order - b.order);
  const i = queue.findIndex((b) => b.id === id);
  const j = i + dir;
  const a = queue[i];
  const b = queue[j];
  if (i < 0 || !a || !b) return null;
  // Gelijke orders (handmatig bewerkt) eerst uit elkaar trekken.
  const ao = a.order === b.order ? i + 1 : a.order;
  const bo = a.order === b.order ? j + 1 : b.order;
  return [a, { order: bo }, b, { order: ao }];
}

/** Wikilink naar de vault-note als die er is (andere bestandsnaam → alias), anders op titel. */
function link(b: Book) {
  const note = b.vaultPath?.split('/').pop()?.replace(/\.md$/, '');
  const target = note && note !== b.title ? `[[${note}|${b.title}]]` : `[[${b.title}]]`;
  return `${target}${b.author ? ` — ${b.author}` : ''}`;
}
const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

/** Markdown voor 20 Privé/23 Persoonlijk/Leeslijst.md. */
export function exportMarkdown(books: Book[]): string {
  const s = sections(books);
  const out: string[] = ['## Nu lezend', ...s.reading.map((b) => `- ${link(b)}`)];
  out.push('', '## Volgende', ...s.queue.map((b, i) => `${i + 1}. ${link(b)}`));
  out.push('', '## Backlog');
  for (const [id, name] of CATEGORIES) {
    const list = s.backlog.filter((b) => b.cat === id).sort(byTitle);
    if (list.length) out.push('', `### ${name}`, ...list.map((b) => `- ${link(b)}`));
  }
  out.push('', '## Uitgelezen', ...s.done.map((b) => `- ${link(b)}${b.rating ? ` — ${stars(b.rating)}` : ''}`));
  if (s.stopped.length) out.push('', '## Gestaakt', ...s.stopped.map((b) => `- ${link(b)}`));
  return out.join('\n') + '\n';
}
