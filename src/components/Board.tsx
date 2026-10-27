import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { ReactNode } from 'react';
import type { Task } from '../../shared/types.js';
import { BOARD_COLUMNS, boardColumn, byCompletedDesc, type BoardColumn } from '../lib/filters';
import { bySortOrder } from '../lib/lists';
import { t, useLang, type TranslationKey } from '../i18n/index.js';

/** Vikunja-achtig kanbanbord voor een project: kolommen per status, slepen verandert de status. */
function Column({ column, tasks, renderRow }: { column: BoardColumn; tasks: Task[]; renderRow: (task: Task) => ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop:board:${column}` });
  return (
    <section
      ref={setNodeRef}
      data-testid={`board-column-${column}`}
      className={`flex w-72 shrink-0 flex-col rounded-xl p-2 transition-colors ${
        isOver ? 'bg-sky-100 ring-2 ring-sky-400 dark:bg-sky-950/50' : 'bg-zinc-100/70 dark:bg-zinc-900/60'
      }`}
    >
      <h3 className="mb-1 flex items-center justify-between px-2 py-1 text-sm font-semibold">
        {t(`board.${column}` as TranslationKey)}
        <span className="text-xs font-normal text-zinc-400">{tasks.length}</span>
      </h3>
      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <ul className="min-h-16 space-y-1.5 *:rounded-lg *:bg-[var(--surface)] *:shadow-sm *:ring-1 *:ring-zinc-200 dark:*:ring-zinc-700">{tasks.map(renderRow)}</ul>
      </SortableContext>
      {column === 'done' && tasks.length === 0 && <p className="px-2 py-4 text-center text-xs text-zinc-400">{t('board.dropToComplete')}</p>}
    </section>
  );
}

export function Board({ header, tasks, renderRow }: { header: ReactNode; tasks: Task[]; renderRow: (task: Task) => ReactNode }) {
  useLang();
  const byColumn = new Map<BoardColumn, Task[]>(BOARD_COLUMNS.map((c) => [c, []]));
  for (const task of tasks) byColumn.get(boardColumn(task))!.push(task);

  return (
    <div className="px-4 pb-32 pt-6 sm:px-10 md:pt-14">
      <div className="max-w-[92rem]">{header}</div>
      <div className="-mx-4 flex items-start gap-3 overflow-x-auto px-4 pb-4 sm:-mx-10 sm:px-10">
        {BOARD_COLUMNS.map((column) => (
          <Column
            key={column}
            column={column}
            tasks={byColumn.get(column)!.sort(column === 'done' ? byCompletedDesc : bySortOrder)}
            renderRow={renderRow}
          />
        ))}
      </div>
    </div>
  );
}
