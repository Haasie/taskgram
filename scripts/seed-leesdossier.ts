/**
 * Idempotente seed voor het Leesdossier: maakt per boek één Postgram-entity (document, tag `book`)
 * en een `related_to`-edge naar de gespiegelde vault-note. Bestaande boeken worden nooit overschreven;
 * herkend op seed-id, en anders op titel + auteur (of alleen titel).
 *
 *   npx tsx scripts/seed-leesdossier.ts data/seed/leesdossier-books.json [--dry-run]
 *
 * Leest POSTGRAM_URL en POSTGRAM_API_KEY uit de omgeving.
 */
import { readFileSync } from 'node:fs';
import { loadConfig } from '../server/config.js';
import { createPostgramClient } from '../server/postgram.js';
import { BOOK_TAG, bookContent, bookFromEntity, bookMetadata, dedupeKey, type BookPatch } from '../modules/leesdossier/book.js';

const VAULT_REPO = 'Thirth-Brain';
const VAULT_DIR = '30 Kennis/38 Objects/Books/';

/** `vault`: bestandsnaam in VAULT_DIR, of een pad vanaf de vault-root als er een / in staat. */
type SeedBook = BookPatch & { seedId: string; title: string; vault?: string };

function vaultPathOf(vault: string) {
  return vault.includes('/') ? vault : VAULT_DIR + vault;
}

const [file, ...flags] = process.argv.slice(2);
if (!file) throw new Error('Gebruik: seed-leesdossier.ts <seed.json> [--dry-run]');
const dryRun = flags.includes('--dry-run');
const seed = JSON.parse(readFileSync(file, 'utf-8')) as { source: string; books: SeedBook[] };

const env = { AUTH_MODE: 'dev', ...process.env };
const pg = createPostgramClient(loadConfig(env));

const existing = await pg.listEntities('document', [BOOK_TAG]);
const bySeed = new Map(existing.map((e) => [String(e.metadata?.seed_id ?? ''), e]));
const byKey = new Map<string, (typeof existing)[number]>();
for (const e of existing) {
  const b = bookFromEntity(e);
  byKey.set(dedupeKey(b.title, b.author), e);
  byKey.set(dedupeKey(b.title), e);
}
console.log(`Bestaande boeken in Postgram: ${existing.length}`);

// Gespiegelde vault-notes: alle documents langs, op metadata.path (eenmalig, ~3500 stuks).
const wanted = new Set(seed.books.filter((b) => b.vault).map((b) => vaultPathOf(b.vault!)));
const vaultIds = new Map<string, string>();
for (let offset = 0; ; offset += 200) {
  const url = new URL(`${env.POSTGRAM_URL!.replace(/\/$/, '')}/api/entities`);
  url.search = new URLSearchParams({ type: 'document', limit: '200', offset: String(offset) }).toString();
  const res = await fetch(url, { headers: { authorization: `Bearer ${env.POSTGRAM_API_KEY}` } });
  if (!res.ok) throw new Error(`Documents ophalen mislukt: ${res.status}`);
  const page = (await res.json()) as { items: { id: string; metadata: Record<string, unknown> | null }[]; total: number };
  for (const d of page.items) {
    const path = d.metadata?.path;
    if (d.metadata?.repo === VAULT_REPO && typeof path === 'string' && wanted.has(path)) vaultIds.set(path, d.id);
  }
  if (offset + 200 >= page.total || page.items.length < 200) break;
}
console.log(`Vault-notes gevonden: ${vaultIds.size} van ${wanted.size}`);

const report = { created: [] as string[], skipped: [] as string[], linked: [] as string[], noVaultNote: [] as string[] };

for (const s of seed.books) {
  const { seedId, vault, ...fields } = s;
  const vaultPath = vault ? vaultPathOf(vault) : null;
  const match = bySeed.get(seedId) ?? byKey.get(dedupeKey(s.title, s.author ?? '')) ?? byKey.get(dedupeKey(s.title));
  let id = match?.id;

  if (match) {
    report.skipped.push(`${s.title} (bestond al: ${match.id})`);
  } else {
    const { id: _id, version: _v, ...defaults } = bookFromEntity({ id: '', version: 0, metadata: {} });
    const book = { ...defaults, ...fields, vaultPath };
    if (!dryRun) {
      const created = await pg.createEntity({
        type: 'document',
        content: bookContent(book),
        visibility: 'personal',
        tags: [BOOK_TAG],
        metadata: { ...bookMetadata(book), seed_id: seedId, seed_source: seed.source }
      });
      id = created.id;
      bySeed.set(seedId, created);
      byKey.set(dedupeKey(s.title, s.author ?? ''), created);
    }
    report.created.push(s.title);
  }

  const noteId = vaultPath ? vaultIds.get(vaultPath) : undefined;
  if (vaultPath && !noteId) report.noVaultNote.push(`${s.title} → ${vaultPath}`);
  if (id && noteId && !dryRun) {
    const edges = await pg.listEdges(id);
    if (!edges.some((e) => e.relation === 'related_to' && (e.target_id === noteId || e.source_id === noteId))) {
      await pg.createEdge(id, noteId, 'related_to');
      report.linked.push(s.title);
    }
  }
}

console.log(JSON.stringify({ dryRun, ...report }, null, 2));
