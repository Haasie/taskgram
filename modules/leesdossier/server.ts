import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../../server/auth.js';
import type { ModuleContext } from '../../server/modules/routes.js';
import { UpstreamError, type RawEntity } from '../../server/postgram.js';
import { todayInZone } from '../../shared/dates.js';
import { BOOK_STATUSES, BOOK_TAG, CATEGORY_IDS, bookContent, bookFromEntity, bookMetadata, type Book, type BookPatch } from './book.js';
import { authorsText, matchBook, syncPatch, type KosyncDocument } from './kosync.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().max(max);

const fields = z
  .object({
    title: text(300).min(1),
    author: text(300),
    status: z.enum(BOOK_STATUSES),
    cat: z.enum(CATEGORY_IDS),
    rating: z.number().int().min(0).max(5),
    progress: z.number().int().min(0).max(100),
    order: z.number().int().min(0).max(100_000),
    note: text(4000),
    src: text(300),
    verify: z.boolean(),
    started: date.nullable(),
    doneAt: date.nullable(),
    updated: date.nullable(),
    vaultPath: text(500).nullable()
  })
  .partial()
  .strict();

const createBody = fields.required({ title: true });
const updateBody = fields.extend({ version: z.number().int().positive() }).strict();
const adoptBody = z.object({ cat: z.enum(CATEGORY_IDS).default('ov') }).strict();


type SyncResult = {
  at: string;
  ok: boolean;
  error?: string;
  documents: number;
  updated: string[];
  unmatched: KosyncDocument[];
};
type KosyncState = { last?: SyncResult; running?: Promise<SyncResult> };

/** KOReader-syncserver (kosync); alleen actief als KOSYNC_URL, KOSYNC_USER en KOSYNC_PASSWORD gezet zijn. */
function kosyncConfig(env: ModuleContext['env']) {
  const url = env.KOSYNC_URL?.trim().replace(/\/$/, '');
  const user = env.KOSYNC_USER?.trim();
  const password = env.KOSYNC_PASSWORD;
  if (!url || !user || !password) return null;
  // KOReader stuurt de MD5 van het wachtwoord als sleutel.
  return { url, user, key: createHash('md5').update(password).digest('hex') };
}

async function fetchDocuments(cfg: NonNullable<ReturnType<typeof kosyncConfig>>): Promise<KosyncDocument[]> {
  let res: Response;
  try {
    res = await fetch(`${cfg.url}/syncs/documents`, {
      headers: { 'x-auth-user': cfg.user, 'x-auth-key': cfg.key, accept: 'application/vnd.koreader.v1+json' },
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    throw new UpstreamError(502, 'KOSYNC_UNAVAILABLE', 'KOReader sync server is unavailable');
  }
  if (res.status === 401) throw new UpstreamError(502, 'KOSYNC_AUTH', 'KOReader sync server rejected the credentials');
  if (!res.ok) throw new UpstreamError(502, 'KOSYNC_ERROR', `KOReader sync server responded with ${res.status}`);
  const body = (await res.json().catch(() => null)) as { documents?: KosyncDocument[] } | null;
  return (body?.documents ?? []).filter((d) => typeof d.document === 'string' && typeof d.percentage === 'number' && typeof d.timestamp === 'number');
}

export function routes(ctx: ModuleContext) {
  const { pg } = ctx;
  const api = new Hono<AuthEnv>();
  const uuid = z.string().uuid();
  const kosync = kosyncConfig(ctx.env);

  /** Alleen entities die echt boeken zijn mogen via deze API veranderen. */
  async function requireBook(id: string): Promise<RawEntity> {
    const entity = await pg.getEntity(uuid.parse(id));
    if (entity.type !== 'document' || !entity.tags.includes(BOOK_TAG)) {
      throw new UpstreamError(404, 'NOT_FOUND', 'Book not found');
    }
    return entity;
  }

  async function createBook(fields: BookPatch) {
    const { id, version, ...defaults } = bookFromEntity({ id: '', version: 0, metadata: {} });
    const book = { ...defaults, ...fields };
    return bookFromEntity(
      await pg.createEntity({ type: 'document', content: bookContent(book), visibility: 'personal', tags: [BOOK_TAG], metadata: bookMetadata(book) })
    );
  }

  async function applyPatch(current: Book, patch: BookPatch, version = current.version) {
    const merged = { ...current, ...patch };
    return bookFromEntity(await pg.updateEntity(current.id, { version, content: bookContent(merged), metadata: bookMetadata(patch) }));
  }

  api.get('/books', async (c) => {
    const items = await pg.listEntities('document', [BOOK_TAG]);
    return c.json({ items: items.map(bookFromEntity) });
  });

  api.post('/books', async (c) => {
    const body: BookPatch = createBody.parse(await c.req.json());
    return c.json({ book: await createBook(body) }, 201);
  });

  api.patch('/books/:id', async (c) => {
    const { version, ...patch } = updateBody.parse(await c.req.json());
    const current = bookFromEntity(await requireBook(c.req.param('id')));
    return c.json({ book: await applyPatch(current, patch, version) });
  });

  api.delete('/books/:id', async (c) => {
    const entity = await requireBook(c.req.param('id'));
    await pg.deleteEntity(entity.id);
    return c.json({ ok: true });
  });

  // --- KOReader-sync: alleen van KOReader naar het Leesdossier ---

  const state = ctx.state as KosyncState;
  const dateOf = (s: number) => todayInZone(new Date(s * 1000), ctx.timeZone);

  async function runSync(): Promise<SyncResult> {
    const at = new Date().toISOString();
    try {
      const docs = await fetchDocuments(kosync!);
      const books = (await pg.listEntities('document', [BOOK_TAG])).map(bookFromEntity);
      const updated: string[] = [];
      const unmatched: KosyncDocument[] = [];
      for (const doc of docs) {
        const book = matchBook(doc, books);
        if (!book) {
          unmatched.push(doc);
          continue;
        }
        const patch = syncPatch(book, doc, dateOf);
        if (!patch) continue;
        try {
          const saved = await applyPatch(book, patch);
          books.splice(books.indexOf(book), 1, saved);
          updated.push(book.title);
        } catch (err) {
          // Versieconflict (net elders bewerkt): volgende ronde opnieuw.
          if (!(err instanceof UpstreamError && err.status === 409)) throw err;
        }
      }
      return (state.last = { at, ok: true, documents: docs.length, updated, unmatched });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error('[leesdossier] KOReader-sync mislukt:', error);
      return (state.last = { at, ok: false, error, documents: 0, updated: [], unmatched: state.last?.unmatched ?? [] });
    }
  }

  /** Eén sync tegelijk; een tweede verzoek wacht op de lopende. */
  ctx.state.sync = () => (state.running ??= runSync().finally(() => (state.running = undefined)));
  const sync = ctx.state.sync as () => Promise<SyncResult>;

  api.get('/kosync', (c) => c.json({ configured: Boolean(kosync), last: state.last ?? null }));

  api.post('/kosync/sync', async (c) => {
    if (!kosync) return c.json({ error: { code: 'KOSYNC_NOT_CONFIGURED', message: 'KOReader sync is not configured' } }, 404);
    return c.json({ last: await sync() });
  });

  /** Onbekend KOReader-document als nieuw boek toevoegen, meteen gekoppeld. */
  api.post('/kosync/adopt/:document', async (c) => {
    if (!kosync) return c.json({ error: { code: 'KOSYNC_NOT_CONFIGURED', message: 'KOReader sync is not configured' } }, 404);
    const { cat } = adoptBody.parse(await c.req.json().catch(() => ({})));
    const doc = (await fetchDocuments(kosync)).find((d) => d.document === c.req.param('document'));
    if (!doc) throw new UpstreamError(404, 'NOT_FOUND', 'Document not found in KOReader sync');
    const title = (doc.title?.trim() || doc.filename?.replace(/\.[a-z0-9]+$/i, '') || doc.document).slice(0, 300);
    const draft = await createBook({ title, author: authorsText(doc.authors).slice(0, 300), cat, note: 'Toegevoegd vanuit KOReader-sync.' });
    const patch = syncPatch(draft, doc, dateOf);
    const book = patch ? await applyPatch(draft, patch) : draft;
    if (state.last) state.last.unmatched = state.last.unmatched.filter((d) => d.document !== doc.document);
    return c.json({ book }, 201);
  });

  return api;
}

/**
 * Periodiek syncen (KOSYNC_SYNC_MINUTES, standaard 15; 0 = alleen via de knop), maar alleen als de
 * module aan staat en kosync geconfigureerd is.
 */
export function start(ctx: ModuleContext) {
  const minutes = Number(ctx.env.KOSYNC_SYNC_MINUTES ?? 15);
  if (!kosyncConfig(ctx.env) || !(minutes > 0)) return;
  const tick = () => {
    const sync = ctx.state.sync as (() => Promise<unknown>) | undefined;
    if (ctx.isEnabled() && sync) void sync();
  };
  setTimeout(tick, 20_000);
  setInterval(tick, minutes * 60_000);
}
