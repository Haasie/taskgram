import '../_design';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ModuleViewProps } from '../types';
import { BOOK_STATUSES, CATEGORIES, categoryName, type Book, type BookPatch, type BookStatus, type Category } from './book';
import { QUARTER_GOAL, counts, exportMarkdown, matches, maxOrder, sections, statusPatch, swapInQueue } from './logic';
import { adoptKosync, createBook, deleteBook, syncKosync, updateBook, useBooks, useKosync, type KosyncStatus } from './data';
import type { KosyncDocument } from './kosync';

type Panel = { kind: 'edit'; book: Book | null } | { kind: 'export' } | null;

export default function LeesdossierView({ today }: ModuleViewProps) {
  const query = useBooks();
  const kosync = useKosync();
  const [syncing, setSyncing] = useState(false);
  const books = useMemo(() => query.data ?? [], [query.data]);
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<Category | ''>('');
  const [panel, setPanel] = useState<Panel>(null);

  const c = counts(books, today);
  const filtered = books.filter((b) => matches(b, search.trim(), cat));
  const s = sections(filtered);
  const filtering = Boolean(search.trim() || cat);
  const year = today.slice(0, 4);

  const setStatus = (b: Book, status: BookStatus) => void updateBook(b.id, statusPatch(b, status, today));
  const move = (b: Book, dir: -1 | 1) => {
    const swap = swapInQueue(books, b.id, dir);
    if (!swap) return;
    void updateBook(swap[0].id, { ...swap[1], updated: today });
    void updateBook(swap[2].id, { ...swap[3], updated: today });
  };
  const edit = (book: Book | null) => setPanel({ kind: 'edit', book });

  return (
    <div className="ld">
      <div className="ld-wrap">
        <header className="ld-head">
          <div className="ld-top">
            <div>
              <div className="ld-label">Thirth Brain · Dossier LL-{year}</div>
              <h1 className="ld-h1">
                Leesdossier<span className="ld-cur" aria-hidden="true" />
              </h1>
              <p className="ld-sub">Eén lijst voor alles wat je leest of wilt lezen. Status: te-lezen, lezend, uit, gestaakt.</p>
            </div>
            <div className="ld-bar">
              {kosync.data?.configured && (
                <button
                  className="ld-btn ld-sec ld-sm"
                  type="button"
                  disabled={syncing}
                  onClick={() => {
                    setSyncing(true);
                    void syncKosync().finally(() => setSyncing(false));
                  }}
                >
                  {syncing ? 'Syncen…' : '⟳ Sync KOReader'}
                </button>
              )}
              <button className="ld-btn ld-sec ld-sm" type="button" onClick={() => setPanel({ kind: 'export' })} disabled={!books.length}>
                Export MD
              </button>
              <button className="ld-btn ld-sm" type="button" onClick={() => edit(null)}>
                + Boek
              </button>
            </div>
          </div>

          <div className="ld-tiles" role="list" aria-label="Tellers">
            <Tile label="Lezend" value={c.reading} color="var(--accent)" />
            <Tile label="Wachtrij" value={c.queue} color="var(--gov)" />
            <Tile label="Backlog" value={c.backlog} color="var(--c-ov)" />
            <Tile label="Uit" value={c.done} color="var(--c-fic)" />
            <Tile label={`Doel ${c.quarter.replace('-', ' ')}`} value={`${c.doneThisQuarter}/${QUARTER_GOAL}`} color="var(--sev-low)">
              <div className="ld-goal" role="progressbar" aria-label="Kwartaaldoel" aria-valuemin={0} aria-valuemax={QUARTER_GOAL} aria-valuenow={c.doneThisQuarter}>
                <i style={{ width: `${Math.min(100, (c.doneThisQuarter / QUARTER_GOAL) * 100)}%` }} />
              </div>
            </Tile>
          </div>
          {kosync.data?.configured && <KosyncLine status={kosync.data} />}

          <input
            type="search"
            className="ld-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek op titel, auteur of notitie"
            aria-label="Zoeken"
          />
          <div className="ld-chips" role="group" aria-label="Filter op categorie">
            <button type="button" className="ld-chip ld-all" aria-pressed={!cat} onClick={() => setCat('')}>
              Alles
            </button>
            {CATEGORIES.map(([id, name]) => {
              const n = books.filter((b) => b.cat === id).length;
              if (!n) return null;
              return (
                <button key={id} type="button" className="ld-chip" style={{ ['--c' as string]: `var(--c-${id})` }} aria-pressed={cat === id} onClick={() => setCat(cat === id ? '' : id)}>
                  {name} <span className="ld-data">{n}</span>
                </button>
              );
            })}
          </div>
        </header>

        {query.isLoading ? (
          <div className="ld-empty">Boeken laden uit Postgram…</div>
        ) : query.isError ? (
          <div className="ld-empty ld-error" role="alert">
            Boeken konden niet worden geladen: {query.error.message}{' '}
            <button className="ld-btn ld-sec ld-sm" type="button" onClick={() => query.refetch()}>
              Opnieuw
            </button>
          </div>
        ) : (
          <main className="ld-main">
            {!books.length && <div className="ld-empty">Nog geen boeken. Voeg het eerste boek toe met “+ Boek”.</div>}

            <Section title="Nu lezend" count={s.reading.length} empty={filtering ? 'Geen boeken die bij dit filter passen.' : 'Niets onderhanden. Start er een uit de wachtrij.'}>
              {s.reading.map((b) => (
                <ReadingCard key={b.id} book={b} today={today} onStatus={setStatus} onEdit={edit} />
              ))}
            </Section>

            <Section title="Wachtrij" count={s.queue.length} empty={filtering ? 'Geen boeken die bij dit filter passen.' : 'Wachtrij leeg. Zet een boek uit de backlog erin met “→ Wachtrij”.'}>
              <ol className="ld-list">
                {s.queue.map((b, i) => (
                  <li key={b.id} className="ld-item">
                    <span className="ld-pos" aria-label={`Plek ${i + 1}`}>
                      {i + 1}
                    </span>
                    <Title book={b} onEdit={edit} />
                    <div className="ld-acts">
                      <button className="ld-btn ld-sec ld-sm" type="button" disabled={filtering || i === 0} onClick={() => move(b, -1)} aria-label={`${b.title} omhoog`}>
                        ↑
                      </button>
                      <button className="ld-btn ld-sec ld-sm" type="button" disabled={filtering || i === s.queue.length - 1} onClick={() => move(b, 1)} aria-label={`${b.title} omlaag`}>
                        ↓
                      </button>
                      <button className="ld-btn ld-sm" type="button" onClick={() => setStatus(b, 'lezend')}>
                        ▶ Start
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            </Section>

            <Section title="Backlog" count={s.backlog.length} empty={filtering ? 'Geen boeken die bij dit filter passen.' : 'Backlog leeg.'}>
              <ul className="ld-list">
                {s.backlog.map((b) => (
                  <li key={b.id} className="ld-item">
                    <CatMark cat={b.cat} />
                    <Title book={b} onEdit={edit} clip />
                    <div className="ld-acts">
                      <button className="ld-btn ld-sec ld-sm" type="button" onClick={() => void updateBook(b.id, { order: maxOrder(books) + 1, updated: today })}>
                        → Wachtrij
                      </button>
                      <button className="ld-btn ld-sec ld-sm" type="button" onClick={() => setStatus(b, 'lezend')}>
                        ▶ Start
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Uitgelezen" count={s.done.length} empty={filtering ? 'Geen boeken die bij dit filter passen.' : 'Nog niets uitgelezen.'}>
              <ul className="ld-list">
                {s.done.map((b) => (
                  <li key={b.id} className="ld-item">
                    <CatMark cat={b.cat} />
                    <Title book={b} onEdit={edit} extra={b.doneAt ? ` · uit op ${b.doneAt}` : ''} />
                    <div className="ld-acts">
                      <Stars book={b} onRate={(rating) => void updateBook(b.id, { rating, updated: today })} />
                    </div>
                  </li>
                ))}
              </ul>
            </Section>

            {(kosync.data?.last?.unmatched.length ?? 0) > 0 && !filtering && (
              <Section title="Onbekend in KOReader" count={kosync.data!.last!.unmatched.length} empty="">
                <ul className="ld-list">
                  {kosync.data!.last!.unmatched.map((d) => (
                    <UnknownDoc key={d.document} doc={d} />
                  ))}
                </ul>
              </Section>
            )}

            {s.stopped.length > 0 && (
              <Section title="Gestaakt" count={s.stopped.length} empty="">
                <ul className="ld-list">
                  {s.stopped.map((b) => (
                    <li key={b.id} className="ld-item">
                      <CatMark cat={b.cat} />
                      <Title book={b} onEdit={edit} />
                      <div className="ld-acts">
                        <button className="ld-btn ld-sec ld-sm" type="button" onClick={() => setStatus(b, 'te-lezen')}>
                          Terug naar backlog
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </main>
        )}
      </div>

      {panel && (
        <Overlay label={panel.kind === 'export' ? 'Export voor Leeslijst.md' : panel.book ? 'Bewerk boek' : 'Nieuw boek'} onClose={() => setPanel(null)}>
          {panel.kind === 'export' ? (
            <ExportPanel markdown={exportMarkdown(books)} />
          ) : (
            <EditPanel book={panel.book} today={today} onDone={() => setPanel(null)} />
          )}
        </Overlay>
      )}
    </div>
  );
}

function Tile({ label, value, color, children }: { label: string; value: ReactNode; color: string; children?: ReactNode }) {
  return (
    <div className="ld-tile" role="listitem" style={{ ['--t' as string]: color }}>
      <span className="ld-label">{label}</span>
      <b>{value}</b>
      {children}
    </div>
  );
}

function Section({ title, count, empty, children }: { title: string; count: number; empty: string; children: ReactNode }) {
  return (
    <section className="ld-section" aria-label={title}>
      <div className="ld-sh">
        <h2>{title}</h2>
        <span className="ld-data">{count}</span>
      </div>
      {count ? children : <div className="ld-empty">{empty}</div>}
    </section>
  );
}

const CatMark = ({ cat }: { cat: Category }) => (
  <span className="ld-mark" style={{ ['--c' as string]: `var(--c-${cat})` }} title={categoryName(cat)} aria-hidden="true" />
);

const Flag = ({ book }: { book: Book }) =>
  book.verify ? (
    <span className="ld-flag" title="Titel of auteur nog niet bevestigd">
      te checken
    </span>
  ) : null;

function metaLine(b: Book) {
  return [b.author || 'auteur onbekend', categoryName(b.cat), b.src ? `via ${b.src}` : ''].filter(Boolean).join(' · ');
}

function Title({ book, onEdit, extra = '', clip }: { book: Book; onEdit: (b: Book) => void; extra?: string; clip?: boolean }) {
  const note = clip && book.note.length > 140 ? `${book.note.slice(0, 140)}…` : book.note;
  return (
    <div className="ld-t">
      <button type="button" className="ld-title" onClick={() => onEdit(book)}>
        {book.title}
      </button>
      <Flag book={book} />
      <div className="ld-meta">
        {metaLine(book)}
        {extra}
      </div>
      {note && <div className="ld-meta">{note}</div>}
    </div>
  );
}

function Stars({ book, onRate }: { book: Book; onRate: (n: number) => void }) {
  return (
    <span className="ld-stars" role="group" aria-label={`Beoordeling: ${book.rating ? `${book.rating} van 5` : 'geen'}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          className={book.rating >= i ? 'ld-on' : ''}
          aria-label={`${i} ${i === 1 ? 'ster' : 'sterren'}`}
          aria-pressed={book.rating === i}
          onClick={() => onRate(book.rating === i ? 0 : i)}
        >
          {book.rating >= i ? '★' : '☆'}
        </button>
      ))}
    </span>
  );
}

function ReadingCard({ book, today, onStatus, onEdit }: { book: Book; today: string; onStatus: (b: Book, s: BookStatus) => void; onEdit: (b: Book) => void }) {
  const [progress, setProgress] = useState(book.progress);
  useEffect(() => setProgress(book.progress), [book.progress]);
  const save = () => progress !== book.progress && void updateBook(book.id, { progress, updated: today });
  return (
    <article className="ld-dossier" aria-label={book.title}>
      <div className="ld-dtab">
        <span className="ld-label">{categoryName(book.cat)}</span>
        <span className="ld-label">
          {book.started ? `sinds ${book.started}` : 'lezend'}
          {book.kosyncAt ? ` · KOReader ${syncTime(book.kosyncAt)}` : ''}
        </span>
      </div>
      <div className="ld-dbody">
        <h3>
          {book.title}
          <Flag book={book} />
        </h3>
        <div className="ld-meta">{book.author || 'auteur onbekend'}{book.src ? ` · via ${book.src}` : ''}</div>
        <div className="ld-prog">
          <span className="ld-label">Voortgang</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={progress}
            aria-label={`Voortgang ${book.title}`}
            onChange={(e) => setProgress(Number(e.target.value))}
            onPointerUp={save}
            onKeyUp={save}
            onBlur={save}
          />
          <span className="ld-data">{progress}%</span>
        </div>
        {book.note && <div className="ld-meta">{book.note}</div>}
        <div className="ld-acts ld-start">
          <button className="ld-btn ld-sm" type="button" onClick={() => onStatus(book, 'uit')}>
            ✓ Uit
          </button>
          <button className="ld-btn ld-sec ld-sm" type="button" onClick={() => onStatus(book, 'gestaakt')}>
            Staken
          </button>
          <button className="ld-btn ld-sec ld-sm" type="button" onClick={() => onEdit(book)}>
            Bewerk
          </button>
        </div>
      </div>
    </article>
  );
}

function Overlay({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    ref.current?.querySelector<HTMLElement>('input, textarea, button.ld-primary')?.focus();
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, []);
  return (
    <div className="ld-ov" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ld-panel" role="dialog" aria-modal="true" aria-label={label} ref={ref}>
        <div className="ld-dtab">
          <span className="ld-label">{label}</span>
          <button className="ld-btn ld-sec ld-sm" type="button" onClick={onClose}>
            Sluit
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ExportPanel({ markdown }: { markdown: string }) {
  const [msg, setMsg] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setMsg('Gekopieerd');
    } catch {
      ref.current?.select();
      setMsg('Selecteer en kopieer handmatig');
    }
  };
  return (
    <div className="ld-dbody">
      <p className="ld-meta">Voor 20 Privé/23 Persoonlijk/Leeslijst.md</p>
      <textarea ref={ref} className="ld-data ld-export" readOnly value={markdown} aria-label="Markdown" />
      <div className="ld-row">
        <button className="ld-btn ld-primary" type="button" onClick={() => void copy()}>
          Kopieer
        </button>
        <span className="ld-data" role="status">
          {msg}
        </span>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<BookStatus, string> = { 'te-lezen': 'te-lezen', lezend: 'lezend', uit: 'uit', gestaakt: 'gestaakt' };

function EditPanel({ book, today, onDone }: { book: Book | null; today: string; onDone: () => void }) {
  const [f, setF] = useState(() => ({
    title: book?.title ?? '',
    author: book?.author ?? '',
    status: book?.status ?? ('te-lezen' as BookStatus),
    cat: book?.cat ?? ('ov' as Category),
    rating: book?.rating ?? 0,
    progress: book?.progress ?? 0,
    order: book?.order ?? 0,
    src: book?.src ?? '',
    note: book?.note ?? '',
    verify: book?.verify ?? false,
    started: book?.started ?? '',
    doneAt: book?.doneAt ?? ''
  }));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(key: K, value: (typeof f)[K]) => setF((prev) => ({ ...prev, [key]: value }));
  const clamp = (v: string, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const title = f.title.trim();
    if (!title || busy) return;
    const patch: BookPatch = {
      title,
      author: f.author.trim(),
      status: f.status,
      cat: f.cat,
      rating: f.rating,
      progress: f.progress,
      order: f.order,
      src: f.src.trim(),
      note: f.note.trim(),
      verify: f.verify,
      started: f.started || null,
      doneAt: f.doneAt || null,
      updated: today
    };
    // Statuswissel via het formulier vult dezelfde velden als de knoppen, tenzij hier zelf ingevuld.
    if (book && f.status !== book.status) {
      const auto = statusPatch(book, f.status, today);
      if (auto.started && !f.started) patch.started = auto.started;
      if (auto.doneAt && !f.doneAt) patch.doneAt = auto.doneAt;
    }
    if (!book && f.status === 'lezend' && !f.started) patch.started = today;
    if (!book && f.status === 'uit' && !f.doneAt) patch.doneAt = today;
    setBusy(true);
    if (book) void updateBook(book.id, patch);
    else await createBook({ ...patch, title });
    setBusy(false);
    onDone();
  };

  return (
    <form className="ld-dbody" onSubmit={(e) => void submit(e)}>
      <Field label="Titel" id="ld-f-title">
        <input id="ld-f-title" required value={f.title} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <Field label="Auteur" id="ld-f-author">
        <input id="ld-f-author" value={f.author} onChange={(e) => set('author', e.target.value)} />
      </Field>
      <div className="ld-two">
        <Field label="Status" id="ld-f-status">
          <select id="ld-f-status" value={f.status} onChange={(e) => set('status', e.target.value as BookStatus)}>
            {BOOK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Categorie" id="ld-f-cat">
          <select id="ld-f-cat" value={f.cat} onChange={(e) => set('cat', e.target.value as Category)}>
            {CATEGORIES.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="ld-two">
        <Field label="Beoordeling (0-5)" id="ld-f-rating">
          <input id="ld-f-rating" type="number" min={0} max={5} value={f.rating} onChange={(e) => set('rating', clamp(e.target.value, 5))} />
        </Field>
        <Field label="Voortgang %" id="ld-f-progress">
          <input id="ld-f-progress" type="number" min={0} max={100} step={5} value={f.progress} onChange={(e) => set('progress', clamp(e.target.value, 100))} />
        </Field>
      </div>
      <Field label="Wachtrij-positie (0 = niet in wachtrij)" id="ld-f-order">
        <input id="ld-f-order" type="number" min={0} value={f.order} onChange={(e) => set('order', clamp(e.target.value, 100_000))} />
      </Field>
      <div className="ld-two">
        <Field label="Gestart" id="ld-f-started">
          <input id="ld-f-started" type="date" value={f.started} onChange={(e) => set('started', e.target.value)} />
        </Field>
        <Field label="Uit op" id="ld-f-done">
          <input id="ld-f-done" type="date" value={f.doneAt} onChange={(e) => set('doneAt', e.target.value)} />
        </Field>
      </div>
      <Field label="Aanbevolen door" id="ld-f-src">
        <input id="ld-f-src" value={f.src} onChange={(e) => set('src', e.target.value)} />
      </Field>
      <Field label="Notitie" id="ld-f-note">
        <textarea id="ld-f-note" value={f.note} onChange={(e) => set('note', e.target.value)} />
      </Field>
      <label className="ld-check">
        <input type="checkbox" checked={f.verify} onChange={(e) => set('verify', e.target.checked)} /> Titel of auteur nog te checken
      </label>
      {book?.vaultPath && <p className="ld-meta">Vault-note: {book.vaultPath}</p>}
      {book?.kosyncAt && <p className="ld-meta">Gekoppeld aan KOReader; laatste sync {syncTime(book.kosyncAt)}. Voortgang en status worden automatisch bijgewerkt.</p>}
      <div className="ld-row">
        <button className="ld-btn" type="submit" disabled={busy}>
          Opslaan
        </button>
        {book &&
          (confirming ? (
            <span className="ld-confirm" role="alert">
              <span className="ld-meta">Definitief verwijderen?</span>
              <button className="ld-btn ld-danger ld-solid" type="button" onClick={() => (void deleteBook(book.id), onDone())}>
                Ja, verwijder
              </button>
              <button className="ld-btn ld-sec" type="button" onClick={() => setConfirming(false)}>
                Annuleer
              </button>
            </span>
          ) : (
            <button className="ld-btn ld-danger" type="button" onClick={() => setConfirming(true)}>
              Verwijder
            </button>
          ))}
      </div>
    </form>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="ld-fld">
      <label className="ld-label" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

const syncTime = (unixSeconds: number) =>
  new Date(unixSeconds * 1000).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function KosyncLine({ status }: { status: KosyncStatus }) {
  const last = status.last;
  if (!last) return <p className="ld-meta ld-kosync">KOReader-sync: nog niet gesynct.</p>;
  const at = syncTime(Date.parse(last.at) / 1000);
  return last.ok ? (
    <p className="ld-meta ld-kosync" role="status">
      KOReader-sync {at} · {last.documents} {last.documents === 1 ? 'document' : 'documenten'}
      {last.updated.length ? ` · bijgewerkt: ${last.updated.join(', ')}` : ' · niets nieuws'}
    </p>
  ) : (
    <p className="ld-meta ld-kosync ld-kosync-error" role="alert">
      ✕ KOReader-sync mislukt ({at}): {last.error}
    </p>
  );
}

function UnknownDoc({ doc }: { doc: KosyncDocument }) {
  const [cat, setCat] = useState<Category>('ov');
  const [busy, setBusy] = useState(false);
  const title = doc.title || doc.filename || doc.document;
  return (
    <li className="ld-item">
      <span className="ld-pos" aria-hidden="true">?</span>
      <div className="ld-t">
        <span className="ld-title-static">{title}</span>
        <div className="ld-meta">
          {[doc.authors?.replace(/\s*;\s*/g, ', '), `${Math.round(doc.percentage * 100)}%`, doc.device, syncTime(doc.timestamp)].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="ld-acts">
        <select className="ld-select" aria-label={`Categorie voor ${title}`} value={cat} onChange={(e) => setCat(e.target.value as Category)}>
          {CATEGORIES.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <button className="ld-btn ld-sm" type="button" disabled={busy} onClick={() => (setBusy(true), void adoptKosync(doc, cat).finally(() => setBusy(false)))}>
          + Toevoegen
        </button>
      </div>
    </li>
  );
}
