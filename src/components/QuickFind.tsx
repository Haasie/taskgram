import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Project, Task } from '../../shared/types.js';
import { isOpen } from '../../shared/taskFields.js';
import { splitContent } from '../lib/task';
import type { Route } from '../lib/useHashView';
import { LIST_META } from './icons';
import { Modal } from './Modal';
import { projectTitle } from './UiContext';
import { t, useLang } from '../i18n/index.js';

type Result = { key: string; label: string; hint: string; run: () => void };

type Props = {
  open: boolean;
  onClose: () => void;
  tasks: Task[];
  projects: Project[];
  onNavigate: (route: Route) => void;
  onOpenTask: (task: Task) => void;
};

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function QuickFind({ open, onClose, tasks, projects, onNavigate, onOpenTask }: Props) {
  useLang();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const results = useMemo<Result[]>(() => {
    const q = normalize(query.trim());
    const lists = Object.entries(LIST_META)
      .filter(([, m]) => !q || normalize(m.label).includes(q))
      .map(([kind, m]) => ({ key: `l:${kind}`, label: m.label, hint: t('quickFind.list'), run: () => onNavigate({ kind } as Route) }));
    if (!q) return lists;
    const projectHits = projects
      .filter((p) => normalize(projectTitle(p)).includes(q))
      .map((p) => ({ key: `p:${p.id}`, label: projectTitle(p), hint: t('quickFind.project'), run: () => onNavigate({ kind: 'project', id: p.id }) }));
    const taskHits = tasks
      .filter((tItem) => isOpen(tItem) && (normalize(tItem.content).includes(q) || tItem.tags.some((tag) => normalize(tag).includes(q))))
      .slice(0, 30)
      .map((tItem) => ({ key: `t:${tItem.id}`, label: splitContent(tItem.content).title, hint: tItem.tags.slice(0, 2).join(', ') || t('quickFind.task'), run: () => onOpenTask(tItem) }));
    return [...lists, ...projectHits, ...taskHits];
  }, [query, tasks, projects, onNavigate, onOpenTask]);

  const choose = (r: Result | undefined) => {
    if (!r) return;
    r.run();
    setQuery('');
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} label={t('quickFind.title')} wide>
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
        <Search size={16} className="text-zinc-400" />
        <input
          autoFocus
          value={query}
          onChange={(e) => (setQuery(e.target.value), setActive(0))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, results.length - 1)));
            if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
            if (e.key === 'Enter') (e.preventDefault(), choose(results[active]));
          }}
          placeholder={t('quickFind.placeholder')}
          className="flex-1 bg-transparent outline-none"
        />
      </div>
      <ul className="max-h-[50vh] overflow-y-auto p-2">
        {results.map((r, i) => (
          <li key={r.key}>
            <button type="button" onMouseEnter={() => setActive(i)} onClick={() => choose(r)} className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${i === active ? 'bg-sky-500 text-white' : ''}`}>
              <span className="flex-1 truncate">{r.label}</span>
              <span className={`text-xs ${i === active ? 'text-sky-100' : 'text-zinc-400'}`}>{r.hint}</span>
            </button>
          </li>
        ))}
        {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-zinc-400">{t('quickFind.noResults')}</li>}
      </ul>
    </Modal>
  );
}
