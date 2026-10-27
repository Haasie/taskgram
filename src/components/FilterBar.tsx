import { Save, Trash2, X } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import type { Project, Visibility } from '../../shared/types.js';
import {
  deleteSavedFilter,
  EMPTY_FILTER,
  filterToQuery,
  loadSavedFilters,
  queryToFilter,
  saveFilter,
  subscribeSavedFilters,
  updateSavedFilter,
  type DueFilter,
  type SortKey,
  type TaskFilter
} from '../lib/filters';
import { AREAS } from '../lib/lists';
import { PrioritySelect } from './Priority';
import { projectTitle } from './UiContext';
import { t, useLang, type TranslationKey } from '../i18n/index.js';

type Props = {
  query: string;
  savedId?: string;
  count: number;
  allTags: string[];
  projects: Project[];
  onChange: (query: string, savedId?: string, opts?: { replace?: boolean }) => void;
};

const DUE: DueFilter[] = ['any', 'overdue', 'today', 'week', 'has', 'none'];
const SORTS: SortKey[] = ['manual', 'due', 'priority', 'title', 'created'];

export function FilterBar({ query, savedId, count, allTags, projects, onChange }: Props) {
  useLang();
  const saved = useSyncExternalStore(subscribeSavedFilters, loadSavedFilters).find((f) => f.id === savedId);
  const filter = queryToFilter(query);
  const set = (patch: Partial<TaskFilter>) => onChange(filterToQuery({ ...filter, ...patch }), savedId, { replace: true });
  const dirty = saved ? saved.query !== query : query !== '';

  const save = () => {
    if (saved) return updateSavedFilter(saved.id, query);
    const name = window.prompt(t('filter.namePrompt'))?.trim();
    if (!name) return;
    const created = saveFilter(name, query);
    onChange(query, created.id, { replace: true });
  };

  const remove = () => {
    if (!saved || !window.confirm(t('filter.deleteConfirm', { name: saved.name }))) return;
    deleteSavedFilter(saved.id);
    onChange('', undefined, { replace: true });
  };

  return (
    <div className="mb-6 space-y-3 rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-700" data-testid="filter-bar">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field sm:col-span-2">
          <span className="section-label">{t('filter.text')}</span>
          <input className="input" value={filter.text} placeholder={t('filter.textPlaceholder')} onChange={(e) => set({ text: e.target.value })} />
        </label>
        <label className="field">
          <span className="section-label">{t('filter.project')}</span>
          <select className="input" value={filter.project ?? ''} onChange={(e) => set({ project: e.target.value || null })}>
            <option value="">{t('filter.anyProject')}</option>
            <option value="none">{t('filter.noProject')}</option>
            {projects
              .filter((p) => p.status !== 'done')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {projectTitle(p)}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span className="section-label">{t('filter.area')}</span>
          <select className="input" value={filter.area ?? ''} onChange={(e) => set({ area: (e.target.value || null) as Visibility | null })}>
            <option value="">{t('filter.anyArea')}</option>
            {AREAS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="section-label">{t('filter.minPriority')}</span>
          <PrioritySelect value={filter.minPriority} onChange={(p) => set({ minPriority: p })} />
        </label>
        <label className="field">
          <span className="section-label">{t('filter.due')}</span>
          <select className="input" value={filter.due} onChange={(e) => set({ due: e.target.value as DueFilter })}>
            {DUE.map((d) => (
              <option key={d} value={d}>
                {t(`filter.due.${d}` as TranslationKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="section-label">{t('filter.sort')}</span>
          <select className="input" value={filter.sort} onChange={(e) => set({ sort: e.target.value as SortKey })}>
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`filter.sort.${s}` as TranslationKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2">
          <input type="checkbox" checked={filter.favorites} onChange={(e) => set({ favorites: e.target.checked })} />
          {t('filter.favorites')}
        </label>
      </div>

      {allTags.length > 0 && (
        <div>
          <span className="section-label">{t('filter.tags')}</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {allTags.map((tag) => {
              const on = filter.tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ tags: on ? filter.tags.filter((x) => x !== tag) : [...filter.tags, tag] })}
                  className={`chip ${on ? '!bg-zinc-700 !text-white dark:!bg-zinc-200 dark:!text-zinc-900' : ''}`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <span className="mr-auto text-xs text-zinc-400">{t('filter.count', { count })}</span>
        {query !== '' && (
          <button type="button" className="btn inline-flex items-center gap-1.5" onClick={() => onChange(filterToQuery(EMPTY_FILTER), savedId, { replace: true })}>
            <X size={14} /> {t('filter.reset')}
          </button>
        )}
        {saved && (
          <button type="button" className="btn inline-flex items-center gap-1.5 text-rose-600" onClick={remove}>
            <Trash2 size={14} /> {t('filter.delete')}
          </button>
        )}
        <button type="button" className="btn btn-primary inline-flex items-center gap-1.5" disabled={!dirty} onClick={save}>
          <Save size={14} /> {saved ? t('filter.update') : t('filter.save')}
        </button>
      </div>
    </div>
  );
}
