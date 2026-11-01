import '../_design';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { localize, optionList } from '../settings';
import type { ModuleViewProps } from '../types';
import { BOOK_STATUSES, categoryIndex, categoryLabel, type Book, type BookPatch, type BookStatus, type Category, type CategoryList } from './book';
import { counts, exportMarkdown, matches, maxOrder, sections, statusPatch, swapInQueue } from './logic';
import { adoptKosync, createBook, deleteBook, syncKosync, updateBook, useBooks, useKosync, type KosyncStatus } from './data';
import type { KosyncDocument } from './kosync';
import { useT } from './i18n';

type Panel = { kind: 'edit'; book: Book | null } | { kind: 'export' } | null;

// Kleuren van het Dossier/Terminal-palet, op volgorde aan de ingestelde categorieën toegekend.
const PALETTE = ['pol', 'fil', 'lead', 'sec', 'fic', 'reis', 'koken', 'ov'];

type Ctx = ReturnType<typeof useT> & { cats: CategoryList; color: (cat: Category) => string };
const LdContext = createContext<Ctx | null>(null);
const useLd = () => useContext(LdContext)!;

export default function LeesdossierView({ today, settings }: ModuleViewProps) {
  const i18n = useT();
  const { t } = i18n;
  const cats: CategoryList = useMemo(
    () => optionList(settings.categories).map((o) => ({ id: o.id, label: localize(o.label, i18n.lang) })),
    [settings.categories, i18n.lang]
  );
  const goal = typeof settings.quarterGoal === 'number' ? settings.quarterGoal : 4;
  const kicker = typeof settings.kicker === 'string' ? settings.kicker : 'Dossier';
  const exportPath = typeof settings.exportPath === 'string' && settings.exportPath ? settings.exportPath : 'Leeslijst.md';
  const ctx: Ctx = { ...i18n, cats, color: (cat) => `var(--c-${PALETTE[categoryIndex(cats, cat) % PALETTE.length]})` };

  const query = useBooks();
  const kosync = useKosync();
  const [syncing, setSyncing] = useState(false);
  const books = useMemo(() => query.data ?? [], [query.data]);
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<Category | ''>('');
  const [panel, setPanel] = useState<Panel>(null);

  const c = counts(books, today);
  const filtered = books.filter((b) => matches(b, search.trim(), cat));
  const s = sections(filtered, cats);
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
    <LdContext.Provider value={ctx}>
    <div className="ld">
      <div className="ld-wrap">
        <header className="ld-head">
          <div className="ld-top">
            <div>
              <div className="ld-label">
                {kicker} LL-{year}
              </div>
              <h1 className="ld-h1">
                {t('title')}
                <span className="ld-cur" aria-hidden="true" />
              </h1>
              <p className="ld-sub">{t('lede')}</p>
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
                  {syncing ? t('syncing') : t('sync')}
                </button>
              )}
              <button className="ld-btn ld-sec ld-sm" type="button" onClick={() => setPanel({ kind: 'export' })} disabled={!books.length}>
                {t('exportBtn')}
              </button>
              <button className="ld-btn ld-sm" type="button" onClick={() => edit(null)}>
                {t('addBook')}
              </button>
            </div>
          </div>

          <div className="ld-tiles" role="list" aria-label={t('counters')}>
            <Tile label={t('tileReading')} value={c.reading} color="var(--accent)" />
            <Tile label={t('tileQueue')} value={c.queue} color="var(--gov)" />
            <Tile label={t('tileBacklog')} value={c.backlog} color="var(--c-ov)" />
            <Tile label={t('tileDone')} value={c.done} color="var(--c-fic)" />
            {goal > 0 && (
              <Tile label={t('tileGoal', { q: c.quarter.replace('-', ' ') })} value={`${c.doneThisQuarter}/${goal}`} color="var(--sev-low)">
                <div className="ld-goal" role="progressbar" aria-label={t('goalAria')} aria-valuemin={0} aria-valuemax={goal} aria-valuenow={c.doneThisQuarter}>
                  <i style={{ width: `${Math.min(100, (c.doneThisQuarter / goal) * 100)}%` }} />
                </div>
              </Tile>
            )}
          </div>
          {kosync.data?.configured && <KosyncLine status={kosync.data} />}

          <input
            type="search"
            className="ld-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search')}
            aria-label={t('searchAria')}
          />
          <div className="ld-chips" role="group" aria-label={t('filterCat')}>
            <button type="button" className="ld-chip ld-all" aria-pressed={!cat} onClick={() => setCat('')}>
              {t('all')}
            </button>
            {cats.map(({ id, label }) => {
              const n = books.filter((b) => categoryIndex(cats, b.cat) === categoryIndex(cats, id)).length;
              if (!n) return null;
              return (
                <button key={id} type="button" className="ld-chip" style={{ ['--c' as string]: ctx.color(id) }} aria-pressed={cat === id} onClick={() => setCat(cat === id ? '' : id)}>
                  {label} <span className="ld-data">{n}</span>
                </button>
              );
            })}
          </div>
        </header>

        {query.isLoading ? (
          <div className="ld-empty">{t('loading')}</div>
        ) : query.isError ? (
          <div className="ld-empty ld-error" role="alert">
            {t('loadFailed', { error: query.error.message })}{' '}
            <button className="ld-btn ld-sec ld-sm" type="button" onClick={() => query.refetch()}>
              {t('retry')}
            </button>
          </div>
        ) : (
          <main className="ld-main">
            {!books.length && <div className="ld-empty">{t('noBooks')}</div>}

            <Section title={t('secReading')} count={s.reading.length} empty={filtering ? t('noMatch') : t('emptyReading')}>
              {s.reading.map((b) => (
                <ReadingCard key={b.id} book={b} today={today} onStatus={setStatus} onEdit={edit} />
              ))}
            </Section>

            <Section title={t('secQueue')} count={s.queue.length} empty={filtering ? t('noMatch') : t('emptyQueue')}>
              <ol className="ld-list">
                {s.queue.map((b, i) => (
                  <li key={b.id} className="ld-item">
                    <span className="ld-pos" aria-label={t('position', { n: i + 1 })}>
                      {i + 1}
                    </span>
                    <Title book={b} onEdit={edit} />
                    <div className="ld-acts">
                      <button className="ld-btn ld-sec ld-sm" type="button" disabled={filtering || i === 0} onClick={() => move(b, -1)} aria-label={t('up', { title: b.title })}>
                        ↑
                      </button>
                      <button className="ld-btn ld-sec ld-sm" type="button" disabled={filtering || i === s.queue.length - 1} onClick={() => move(b, 1)} aria-label={t('down', { title: b.title })}>
                        ↓
                      </button>
                      <button className="ld-btn ld-sm" type="button" onClick={() => setStatus(b, 'lezend')}>
                        {t('start')}
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            </Section>

            <Section title={t('secBacklog')} count={s.backlog.length} empty={filtering ? t('noMatch') : t('emptyBacklog')}>
              <ul className="ld-list">
                {s.backlog.map((b) => (
                  <li key={b.id} className="ld-item">
                    <CatMark cat={b.cat} />
                    <Title book={b} onEdit={edit} clip />
                    <div className="ld-acts">
                      <button className="ld-btn ld-sec ld-sm" type="button" onClick={() => void updateBook(b.id, { order: maxOrder(books) + 1, updated: today })}>
                        {t('toQueue')}
                      </button>
                      <button className="ld-btn ld-sec ld-sm" type="button" onClick={() => setStatus(b, 'lezend')}>
                        {t('start')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title={t('secDone')} count={s.done.length} empty={filtering ? t('noMatch') : t('emptyDone')}>
              <ul className="ld-list">
                {s.done.map((b) => (
                  <li key={b.id} className="ld-item">
                    <CatMark cat={b.cat} />
                    <Title book={b} onEdit={edit} extra={b.doneAt ? t('doneOn', { date: b.doneAt }) : ''} />
                    <div className="ld-acts">
                      <Stars book={b} onRate={(rating) => void updateBook(b.id, { rating, updated: today })} />
                    </div>
                  </li>
                ))}
              </ul>
            </Section>

            {(kosync.data?.last?.unmatched.length ?? 0) > 0 && !filtering && (
              <Section title={t('secUnknown')} count={kosync.data!.last!.unmatched.length} empty="">
                <ul className="ld-list">
                  {kosync.data!.last!.unmatched.map((d) => (
                    <UnknownDoc key={d.document} doc={d} />
                  ))}
                </ul>
              </Section>
            )}

            {s.stopped.length > 0 && (
              <Section title={t('secStopped')} count={s.stopped.length} empty="">
                <ul className="ld-list">
                  {s.stopped.map((b) => (
                    <li key={b.id} className="ld-item">
                      <CatMark cat={b.cat} />
                      <Title book={b} onEdit={edit} />
                      <div className="ld-acts">
                        <button className="ld-btn ld-sec ld-sm" type="button" onClick={() => setStatus(b, 'te-lezen')}>
                          {t('backToBacklog')}
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
        <Overlay label={panel.kind === 'export' ? t('exportFor', { path: exportPath }) : panel.book ? t('editBook') : t('newBook')} onClose={() => setPanel(null)}>
          {panel.kind === 'export' ? (
            <ExportPanel
              path={exportPath}
              markdown={exportMarkdown(books, cats, { reading: t('hReading'), next: t('hNext'), backlog: t('hBacklog'), done: t('hDone'), stopped: t('hStopped') })}
            />
          ) : (
            <EditPanel book={panel.book} today={today} onDone={() => setPanel(null)} />
          )}
        </Overlay>
      )}
    </div>
    </LdContext.Provider>
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

function CatMark({ cat }: { cat: Category }) {
  const { cats, color } = useLd();
  return <span className="ld-mark" style={{ ['--c' as string]: color(cat) }} title={categoryLabel(cats, cat)} aria-hidden="true" />;
}

function Flag({ book }: { book: Book }) {
  const { t } = useLd();
  return book.verify ? (
    <span className="ld-flag" title={t('verifyTitle')}>
      {t('verifyFlag')}
    </span>
  ) : null;
}

function useMetaLine() {
  const { t, cats } = useLd();
  return (b: Book) => [b.author || t('authorUnknown'), categoryLabel(cats, b.cat), b.src ? t('via', { src: b.src }) : ''].filter(Boolean).join(' · ');
}

function Title({ book, onEdit, extra = '', clip }: { book: Book; onEdit: (b: Book) => void; extra?: string; clip?: boolean }) {
  const metaLine = useMetaLine();
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
  const { t } = useLd();
  return (
    <span className="ld-stars" role="group" aria-label={t('rating', { r: book.rating ? t('ratingOf', { n: book.rating }) : t('ratingNone') })}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          className={book.rating >= i ? 'ld-on' : ''}
          aria-label={t(i === 1 ? 'star' : 'stars', { n: i })}
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
  const { t, cats, locale } = useLd();
  const [progress, setProgress] = useState(book.progress);
  useEffect(() => setProgress(book.progress), [book.progress]);
  const save = () => progress !== book.progress && void updateBook(book.id, { progress, updated: today });
  return (
    <article className="ld-dossier" aria-label={book.title}>
      <div className="ld-dtab">
        <span className="ld-label">{categoryLabel(cats, book.cat)}</span>
        <span className="ld-label">
          {book.started ? t('since', { date: book.started }) : t('reading')}
          {book.kosyncAt ? t('koreaderAt', { time: syncTime(book.kosyncAt, locale) }) : ''}
        </span>
      </div>
      <div className="ld-dbody">
        <h3>
          {book.title}
          <Flag book={book} />
        </h3>
        <div className="ld-meta">
          {book.author || t('authorUnknown')}
          {book.src ? ` · ${t('via', { src: book.src })}` : ''}
        </div>
        <div className="ld-prog">
          <span className="ld-label">{t('progress')}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={progress}
            aria-label={t('progressOf', { title: book.title })}
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
            {t('markDone')}
          </button>
          <button className="ld-btn ld-sec ld-sm" type="button" onClick={() => onStatus(book, 'gestaakt')}>
            {t('stop')}
          </button>
          <button className="ld-btn ld-sec ld-sm" type="button" onClick={() => onEdit(book)}>
            {t('edit')}
          </button>
        </div>
      </div>
    </article>
  );
}

function Overlay({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const { t } = useLd();
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
            {t('close')}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ExportPanel({ markdown, path }: { markdown: string; path: string }) {
  const { t } = useLd();
  const [msg, setMsg] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setMsg(t('copied'));
    } catch {
      ref.current?.select();
      setMsg(t('copyManually'));
    }
  };
  return (
    <div className="ld-dbody">
      <p className="ld-meta">{t('exportHint', { path })}</p>
      <textarea ref={ref} className="ld-data ld-export" readOnly value={markdown} aria-label="Markdown" />
      <div className="ld-row">
        <button className="ld-btn ld-primary" type="button" onClick={() => void copy()}>
          {t('copy')}
        </button>
        <span className="ld-data" role="status">
          {msg}
        </span>
      </div>
    </div>
  );
}

function EditPanel({ book, today, onDone }: { book: Book | null; today: string; onDone: () => void }) {
  const { t, status: statusLabel, cats, locale } = useLd();
  const [f, setF] = useState(() => ({
    title: book?.title ?? '',
    author: book?.author ?? '',
    status: book?.status ?? ('te-lezen' as BookStatus),
    cat: book ? cats[categoryIndex(cats, book.cat)]?.id ?? book.cat : cats[cats.length - 1]?.id ?? 'ov',
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
      <Field label={t('fTitle')} id="ld-f-title">
        <input id="ld-f-title" required value={f.title} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <Field label={t('fAuthor')} id="ld-f-author">
        <input id="ld-f-author" value={f.author} onChange={(e) => set('author', e.target.value)} />
      </Field>
      <div className="ld-two">
        <Field label={t('fStatus')} id="ld-f-status">
          <select id="ld-f-status" value={f.status} onChange={(e) => set('status', e.target.value as BookStatus)}>
            {BOOK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('fCategory')} id="ld-f-cat">
          <select id="ld-f-cat" value={f.cat} onChange={(e) => set('cat', e.target.value)}>
            {cats.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="ld-two">
        <Field label={t('fRating')} id="ld-f-rating">
          <input id="ld-f-rating" type="number" min={0} max={5} value={f.rating} onChange={(e) => set('rating', clamp(e.target.value, 5))} />
        </Field>
        <Field label={t('fProgress')} id="ld-f-progress">
          <input id="ld-f-progress" type="number" min={0} max={100} step={5} value={f.progress} onChange={(e) => set('progress', clamp(e.target.value, 100))} />
        </Field>
      </div>
      <Field label={t('fOrder')} id="ld-f-order">
        <input id="ld-f-order" type="number" min={0} value={f.order} onChange={(e) => set('order', clamp(e.target.value, 100_000))} />
      </Field>
      <div className="ld-two">
        <Field label={t('fStarted')} id="ld-f-started">
          <input id="ld-f-started" type="date" value={f.started} onChange={(e) => set('started', e.target.value)} />
        </Field>
        <Field label={t('fDone')} id="ld-f-done">
          <input id="ld-f-done" type="date" value={f.doneAt} onChange={(e) => set('doneAt', e.target.value)} />
        </Field>
      </div>
      <Field label={t('fSrc')} id="ld-f-src">
        <input id="ld-f-src" value={f.src} onChange={(e) => set('src', e.target.value)} />
      </Field>
      <Field label={t('fNote')} id="ld-f-note">
        <textarea id="ld-f-note" value={f.note} onChange={(e) => set('note', e.target.value)} />
      </Field>
      <label className="ld-check">
        <input type="checkbox" checked={f.verify} onChange={(e) => set('verify', e.target.checked)} /> {t('fVerify')}
      </label>
      {book?.vaultPath && <p className="ld-meta">{t('vaultNote', { path: book.vaultPath })}</p>}
      {book?.kosyncAt && <p className="ld-meta">{t('koreaderLinked', { time: syncTime(book.kosyncAt, locale) })}</p>}
      <div className="ld-row">
        <button className="ld-btn" type="submit" disabled={busy}>
          {t('save')}
        </button>
        {book &&
          (confirming ? (
            <span className="ld-confirm" role="alert">
              <span className="ld-meta">{t('confirmDelete')}</span>
              <button className="ld-btn ld-danger ld-solid" type="button" onClick={() => (void deleteBook(book.id), onDone())}>
                {t('yesDelete')}
              </button>
              <button className="ld-btn ld-sec" type="button" onClick={() => setConfirming(false)}>
                {t('cancel')}
              </button>
            </span>
          ) : (
            <button className="ld-btn ld-danger" type="button" onClick={() => setConfirming(true)}>
              {t('delete')}
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

const syncTime = (unixSeconds: number, locale: string) =>
  new Date(unixSeconds * 1000).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function KosyncLine({ status }: { status: KosyncStatus }) {
  const { t, locale } = useLd();
  const last = status.last;
  if (!last) return <p className="ld-meta ld-kosync">{t('syncNever')}</p>;
  const at = syncTime(Date.parse(last.at) / 1000, locale);
  return last.ok ? (
    <p className="ld-meta ld-kosync" role="status">
      {t('syncOk', { time: at, n: last.documents, docs: last.documents === 1 ? t('document') : t('documents') })}
      {last.updated.length ? t('syncUpdated', { titles: last.updated.join(', ') }) : t('syncNothing')}
    </p>
  ) : (
    <p className="ld-meta ld-kosync ld-kosync-error" role="alert">
      {t('syncFailed', { time: at, error: last.error ?? '' })}
    </p>
  );
}

function UnknownDoc({ doc }: { doc: KosyncDocument }) {
  const { t, cats, locale } = useLd();
  const [cat, setCat] = useState<Category>(cats[cats.length - 1]?.id ?? 'ov');
  const [busy, setBusy] = useState(false);
  const title = doc.title || doc.filename || doc.document;
  return (
    <li className="ld-item">
      <span className="ld-pos" aria-hidden="true">?</span>
      <div className="ld-t">
        <span className="ld-title-static">{title}</span>
        <div className="ld-meta">
          {[doc.authors?.replace(/\s*;\s*/g, ', '), `${Math.round(doc.percentage * 100)}%`, doc.device, syncTime(doc.timestamp, locale)].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="ld-acts">
        <select className="ld-select" aria-label={t('categoryFor', { title })} value={cat} onChange={(e) => setCat(e.target.value)}>
          {cats.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <button className="ld-btn ld-sm" type="button" disabled={busy} onClick={() => (setBusy(true), void adoptKosync(doc, cat).finally(() => setBusy(false)))}>
          {t('adopt')}
        </button>
      </div>
    </li>
  );
}
