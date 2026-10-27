import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Link2, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { queryClient } from '../lib/queries';
import { useSyncStatus } from '../lib/sync';
import { showToast } from '../lib/toast';
import { TASK_RELATIONS, type LinkedEntity, type TaskRelation } from '../../shared/types.js';
import { useUi } from './UiContext';
import { t, useLang, type TranslationKey } from '../i18n/index.js';

const firstLine = (s: string) => s.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '') ?? '';

/** Naam van een relatie vanuit deze taak gezien, zoals Vikunja's "geblokkeerd door" / "blokkeert". */
export function relationLabel(relation: string, direction: LinkedEntity['direction']): string {
  if (relation === 'related_to') return t('relation.related_to');
  if ((TASK_RELATIONS as readonly string[]).includes(relation)) {
    return t(`relation.${relation}.${direction === 'outgoing' ? 'out' : 'in'}` as TranslationKey);
  }
  return relation.replace(/_/g, ' ');
}

const relationOption = (r: TaskRelation) => (r === 'related_to' ? t('relation.related_to') : t(`relation.${r}.out` as TranslationKey));

export function LinkedKnowledge({ taskId }: { taskId: string }) {
  useLang();
  const typeLabel: Record<string, string> = {
    memory: t('knowledge.type.memory'),
    person: t('knowledge.type.person'),
    project: t('knowledge.type.project'),
    task: t('knowledge.type.task'),
    interaction: t('knowledge.type.interaction'),
    document: t('knowledge.type.document')
  };

  const ui = useUi();
  const { online } = useSyncStatus();
  const [relation, setRelation] = useState<TaskRelation>('related_to');
  const key = ['links', taskId];
  const links = useQuery({ queryKey: key, queryFn: () => api.links(taskId), enabled: online });
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const time = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(time);
  }, [query]);

  const hits = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.search(debounced),
    enabled: debounced.length >= 2 && online
  });

  const linkedIds = new Set(links.data?.map((l) => l.entity?.id));

  const add = async (id: string) => {
    if (!online) {
      showToast(t('toast.offline'));
      return;
    }
    try {
      await api.addLink(taskId, id, relation);
      setQuery('');
      setSearching(false);
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (err) {
      showToast(t('knowledge.linkFailed', { error: err instanceof Error ? err.message : '' }));
    }
  };

  const remove = async (edgeId: string) => {
    if (!online) {
      showToast(t('toast.offline'));
      return;
    }
    try {
      await api.removeLink(taskId, edgeId);
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (err) {
      showToast(t('knowledge.unlinkFailed', { error: err instanceof Error ? err.message : '' }));
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="section-label">{t('knowledge.title')}</span>
        {!online ? (
          <span className="text-xs text-zinc-400" title={t('toast.offline')}>
            {t('toast.offline')}
          </span>
        ) : (
          <button type="button" className="text-xs text-sky-600 hover:underline" onClick={() => setSearching((s) => !s)}>
            {searching ? t('knowledge.close') : t('knowledge.link')}
          </button>
        )}
      </div>
      {searching && (
        <div className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-zinc-400" />
            <select
              value={relation}
              onChange={(e) => setRelation(e.target.value as TaskRelation)}
              aria-label={t('relation.label')}
              className="rounded bg-zinc-100 px-1 py-0.5 text-xs outline-none dark:bg-zinc-800"
            >
              {TASK_RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {relationOption(r)}
                </option>
              ))}
            </select>
            <input
              autoFocus
              disabled={!online}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={online ? t('knowledge.searchPlaceholder') : t('toast.offline')}
              className="flex-1 bg-transparent text-sm outline-none disabled:opacity-50"
            />
          </div>
          {!online && <p className="mt-2 text-xs text-zinc-400">{t('toast.offline')}</p>}
          {hits.isFetching && <p className="mt-2 text-xs text-zinc-400">{t('knowledge.searching')}</p>}
          <ul className="mt-1 max-h-60 overflow-y-auto">
            {hits.data
              ?.filter((h) => h.id !== taskId && !linkedIds.has(h.id))
              .map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    disabled={!online}
                    title={!online ? t('toast.offline') : undefined}
                    onClick={() => add(h.id)}
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
                  >
                    <span className="mr-1.5 text-[11px] font-medium uppercase text-zinc-400">{typeLabel[h.type] ?? h.type}</span>
                    {firstLine(h.content)}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
      {links.isLoading && <p className="text-xs text-zinc-400">{t('knowledge.loading')}</p>}
      <ul className="space-y-1">
        {links.data?.map((l) => {
          const linkedTask = l.entity?.type === 'task' ? ui.tasksById.get(l.entity.id) : undefined;
          return (
          <li key={l.edgeId} className="group flex items-start gap-2 rounded-lg bg-zinc-50 px-2 py-1.5 text-sm dark:bg-zinc-800/60">
            <Link2 size={14} className="mt-0.5 shrink-0 text-zinc-400" />
            <details className="min-w-0 flex-1">
              <summary className="cursor-pointer list-none truncate">
                <span className="mr-1.5 text-[11px] font-medium uppercase text-zinc-400">{l.entity ? typeLabel[l.entity.type] ?? l.entity.type : '?'}</span>
                {l.entity ? firstLine(l.entity.content) : t('knowledge.notAccessible')}
                <span className="ml-1.5 text-[11px] text-zinc-400">{relationLabel(l.relation, l.direction)}</span>
              </summary>
              {l.entity && <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-500">{l.entity.content}</p>}
            </details>
            {linkedTask && (
              <button type="button" onClick={() => ui.openTask(linkedTask)} title={t('relation.open')} aria-label={t('relation.open')} className="opacity-50 hover:opacity-100">
                <ExternalLink size={14} />
              </button>
            )}
            <button
              type="button"
              disabled={!online}
              title={!online ? t('toast.offline') : t('knowledge.unlink')}
              aria-label={!online ? t('toast.offline') : t('knowledge.unlink')}
              onClick={() => remove(l.edgeId)}
              className="opacity-40 hover:opacity-100 disabled:opacity-20 sm:opacity-0 sm:group-hover:opacity-60"
            >
              <X size={14} />
            </button>
          </li>
          );
        })}
        {links.data?.length === 0 && !searching && <li className="text-xs text-zinc-400">{t('knowledge.empty')}</li>}
      </ul>
    </div>
  );
}
