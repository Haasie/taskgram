/** Leesdossier: één Postgram-entity per boek (type document, tag `book`), velden in metadata. */

export const BOOK_TAG = 'book';

export const BOOK_STATUSES = ['te-lezen', 'lezend', 'uit', 'gestaakt'] as const;
export type BookStatus = (typeof BOOK_STATUSES)[number];

export const CATEGORIES = [
  ['pol', 'Politiek & Geschiedenis'],
  ['fil', 'Filosofie & Psychologie'],
  ['lead', 'Leiderschap & Business'],
  ['sec', 'Security & Techniek'],
  ['fic', 'Fictie'],
  ['reis', 'Reizen & Cultuur'],
  ['koken', 'Koken & Lifestyle'],
  ['ov', 'Overig']
] as const;
export type Category = (typeof CATEGORIES)[number][0];
export const CATEGORY_IDS = CATEGORIES.map((c) => c[0]) as unknown as readonly [Category, ...Category[]];
export const categoryName = (cat: string) => CATEGORIES.find((c) => c[0] === cat)?.[1] ?? 'Overig';

export type Book = {
  id: string;
  version: number;
  title: string;
  author: string;
  status: BookStatus;
  cat: Category;
  /** 0 = geen beoordeling, anders 1–5. */
  rating: number;
  /** 0–100. */
  progress: number;
  /** Plek in de wachtrij; 0 = niet in de wachtrij. */
  order: number;
  note: string;
  /** Aanbevolen door. */
  src: string;
  /** Titel of auteur nog niet bevestigd. */
  verify: boolean;
  started: string | null;
  doneAt: string | null;
  updated: string | null;
  /** Pad van de bijbehorende vault-note, als die er is. */
  vaultPath: string | null;
};

export type BookFields = Omit<Book, 'id' | 'version'>;
export type BookPatch = Partial<BookFields>;

/** Sleutels in Postgram-metadata (snake_case, zoals de rest van Taskgram). */
const META_KEYS: Record<keyof BookFields, string> = {
  title: 'title',
  author: 'author',
  status: 'status',
  cat: 'cat',
  rating: 'rating',
  progress: 'progress',
  order: 'order',
  note: 'note',
  src: 'src',
  verify: 'verify',
  started: 'started',
  doneAt: 'done_at',
  updated: 'updated',
  vaultPath: 'vault_path'
};

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : 0;
const dateOrNull = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export function bookFromEntity(raw: { id: string; version: number; metadata: Record<string, unknown> | null }): Book {
  const m = raw.metadata ?? {};
  const status = (BOOK_STATUSES as readonly string[]).includes(str(m.status)) ? (m.status as BookStatus) : 'te-lezen';
  const cat = (CATEGORY_IDS as readonly string[]).includes(str(m.cat)) ? (m.cat as Category) : 'ov';
  return {
    id: raw.id,
    version: raw.version,
    title: str(m.title),
    author: str(m.author),
    status,
    cat,
    rating: num(m.rating, 0, 5),
    progress: num(m.progress, 0, 100),
    order: num(m.order, 0, 100_000),
    note: str(m.note),
    src: str(m.src),
    verify: m.verify === true,
    started: dateOrNull(m.started),
    doneAt: dateOrNull(m.done_at),
    updated: dateOrNull(m.updated),
    vaultPath: typeof m.vault_path === 'string' && m.vault_path ? m.vault_path : null
  };
}

/** Patch → Postgram-metadata. Lege tekst wordt null, zodat Postgram het veld leegmaakt. */
export function bookMetadata(patch: BookPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch) as [keyof BookFields, unknown][]) {
    const metaKey = META_KEYS[key];
    if (value === undefined || !metaKey) continue;
    out[metaKey] = value === '' ? null : value;
  }
  return out;
}

/** Zoekbare tekst in Postgram: titel, auteur en notitie. */
export function bookContent(b: Pick<Book, 'title' | 'author' | 'note'>): string {
  const head = b.author ? `${b.title} — ${b.author}` : b.title;
  return b.note ? `${head}\n\n${b.note}` : head;
}

/** Sleutel om dubbelen te herkennen: titel + auteur, zonder hoofdletters, leestekens en lidwoord vooraan. */
export function dedupeKey(title: string, author = ''): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  return `${norm(title).replace(/^(the|de|het|een|a) /, '')}|${norm(author)}`;
}
