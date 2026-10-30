import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../../server/auth.js';
import { UpstreamError, type PostgramClient, type RawEntity } from '../../server/postgram.js';
import { BOOK_STATUSES, BOOK_TAG, CATEGORY_IDS, bookContent, bookFromEntity, bookMetadata, type BookPatch } from './book.js';

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

export function routes(pg: PostgramClient) {
  const api = new Hono<AuthEnv>();
  const uuid = z.string().uuid();

  /** Alleen entities die echt boeken zijn mogen via deze API veranderen. */
  async function requireBook(id: string): Promise<RawEntity> {
    const entity = await pg.getEntity(uuid.parse(id));
    if (entity.type !== 'document' || !entity.tags.includes(BOOK_TAG)) {
      throw new UpstreamError(404, 'NOT_FOUND', 'Book not found');
    }
    return entity;
  }

  api.get('/books', async (c) => {
    const items = await pg.listEntities('document', [BOOK_TAG]);
    return c.json({ items: items.map(bookFromEntity) });
  });

  api.post('/books', async (c) => {
    const body: BookPatch = createBody.parse(await c.req.json());
    const { id, version, ...defaults } = bookFromEntity({ id: '', version: 0, metadata: {} });
    const book = { ...defaults, ...body };
    const created = await pg.createEntity({
      type: 'document',
      content: bookContent(book),
      visibility: 'personal',
      tags: [BOOK_TAG],
      metadata: bookMetadata(book)
    });
    return c.json({ book: bookFromEntity(created) }, 201);
  });

  api.patch('/books/:id', async (c) => {
    const { version, ...patch } = updateBody.parse(await c.req.json());
    const current = bookFromEntity(await requireBook(c.req.param('id')));
    const merged = { ...current, ...patch };
    const updated = await pg.updateEntity(current.id, {
      version,
      content: bookContent(merged),
      metadata: bookMetadata(patch)
    });
    return c.json({ book: bookFromEntity(updated) });
  });

  api.delete('/books/:id', async (c) => {
    const entity = await requireBook(c.req.param('id'));
    await pg.deleteEntity(entity.id);
    return c.json({ ok: true });
  });

  return api;
}
