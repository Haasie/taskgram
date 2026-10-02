import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatLong } from '../../shared/dates.js';
import { completedAt, completionDay } from '../../shared/taskFields.js';
import { TaskRow } from './TaskRow';
import type { ReactNode } from 'react';
import { useSyncStatus } from '../lib/sync';
import { t, useLang } from '../i18n/index.js';

export function Logbook({ header }: { header: ReactNode }) {
  useLang();
  const { online } = useSyncStatus();
  const query = useInfiniteQuery({
    queryKey: ['logbook'],
    queryFn: ({ pageParam }) => api.logbook(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    }
  });

  const tasks = (query.data?.pages.flatMap((p) => p.items) ?? []).sort((a, b) => completedAt(b).localeCompare(completedAt(a)));
  const groups = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const key = completionDay(t) ?? 'earlier';
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    if (a === 'earlier') return 1;
    if (b === 'earlier') return -1;
    return b.localeCompare(a);
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-32 pt-6 sm:px-10 md:pt-14">
      {header}
      {query.isLoading && <p className="text-sm text-zinc-400">{t('logbook.loading')}</p>}
      {sortedKeys.map((key) => {
        const items = groups.get(key)!;
        return (
          <section key={key} className="mt-6">
            <h3 className="mb-1 border-b border-zinc-200 pb-1 text-sm font-bold text-zinc-500 dark:border-zinc-700">
              {key === 'earlier' ? t('logbook.earlier') : formatLong(key)}
            </h3>
            <ul className="-mx-2">
              {items.map((t) => (
                <TaskRow key={t.id} task={t} showProject sortable={false} />
              ))}
            </ul>
          </section>
        );
      })}
      {query.hasNextPage && (
        <button
          type="button"
          disabled={!online || query.isFetchingNextPage}
          title={!online ? t('toast.offline') : undefined}
          onClick={() => query.fetchNextPage()}
          className="mt-6 text-sm text-sky-600 hover:underline disabled:text-zinc-400 disabled:no-underline"
        >
          {!online ? t('toast.offline') : query.isFetchingNextPage ? t('logbook.loading') : t('logbook.loadMore')}
        </button>
      )}
      {!query.isLoading && tasks.length === 0 && <p className="mt-16 text-center text-sm text-zinc-400">{t('logbook.empty')}</p>}
    </div>
  );
}
