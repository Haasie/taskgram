import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { Moon } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { Section } from '../lib/lists';

type Props = {
  header: ReactNode;
  sections: Section[];
  showProject?: boolean;
  showWhen?: boolean;
  emptyText: string;
  children?: ReactNode;
  renderRow: (task: Section['tasks'][number], opts: { showProject: boolean; showWhen: boolean }) => ReactNode;
};

function SectionBlock({ section, children }: { section: Section; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `section:${section.key}`, data: { section: section.key } });
  if (!section.title) return <div ref={setNodeRef}>{children}</div>;
  return (
    <section ref={setNodeRef} className={`mt-7 rounded-lg ${isOver ? 'bg-sky-50 dark:bg-sky-950/30' : ''}`}>
      <h3 className={`mb-1 flex items-center gap-1.5 border-b border-zinc-200 pb-1 text-[15px] font-bold dark:border-zinc-700 ${section.tone === 'evening' ? 'text-sky-700 dark:text-sky-400' : 'text-sky-600 dark:text-sky-400'}`}>
        {section.tone === 'evening' && <Moon size={15} className="fill-current" />}
        {section.title}
      </h3>
      {children}
    </section>
  );
}

export function ListView({ header, sections, showProject = false, showWhen = false, emptyText, children, renderRow }: Props) {
  const [tag, setTag] = useState<string | null>(null);

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sections) for (const t of s.tasks) for (const tg of t.tags) counts.set(tg, (counts.get(tg) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t);
  }, [sections]);

  const visible = tag ? sections.map((s) => ({ ...s, tasks: s.tasks.filter((t) => t.tags.includes(tag)) })) : sections;
  const total = visible.reduce((n, s) => n + s.tasks.length, 0);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-32 pt-6 sm:px-10 md:pt-14">
      {header}
      {tags.length > 1 && (
        <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {tags.map((t) => (
            <button key={t} type="button" onClick={() => setTag(tag === t ? null : t)} className={`chip shrink-0 ${tag === t ? '!bg-zinc-700 !text-white dark:!bg-zinc-200 dark:!text-zinc-900' : ''}`}>
              {t}
            </button>
          ))}
        </div>
      )}
      {children}
      {visible.map((section) =>
        section.tasks.length === 0 && !section.title ? null : (
          <SectionBlock key={section.key} section={section}>
            <SortableContext items={section.tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              <ul className="-mx-2">{section.tasks.map((t) => renderRow(t, { showProject, showWhen }))}</ul>
            </SortableContext>
          </SectionBlock>
        )
      )}
      {total === 0 && !children && <p className="mt-16 text-center text-sm text-zinc-400">{emptyText}</p>}
    </div>
  );
}
