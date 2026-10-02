import { X } from 'lucide-react';
import { useRef } from 'react';
import type { ChecklistItem } from '../../shared/types.js';
import { newId } from '../lib/task';
import { t, useLang } from '../i18n/index.js';

export function Checklist({ items, onChange }: { items: ChecklistItem[]; onChange: (items: ChecklistItem[]) => void }) {
  useLang();
  const refs = useRef(new Map<string, HTMLInputElement>());

  const update = (id: string, patch: Partial<ChecklistItem>) => onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const insertAfter = (index: number) => {
    const item = { id: newId(), text: '', done: false };
    onChange([...items.slice(0, index + 1), item, ...items.slice(index + 1)]);
    requestAnimationFrame(() => refs.current.get(item.id)?.focus());
  };

  return (
    <ul className="space-y-0.5">
      {items.map((item, index) => (
        <li key={item.id} className="group flex items-center gap-2 border-b border-zinc-100 py-1 dark:border-zinc-800">
          <button
            type="button"
            role="checkbox"
            aria-checked={item.done}
            onClick={() => update(item.id, { done: !item.done })}
            className={`size-3.5 shrink-0 rounded-full border ${item.done ? 'border-sky-500 bg-sky-500' : 'border-zinc-400'}`}
          />
          <input
            ref={(el) => {
              if (el) refs.current.set(item.id, el);
              else refs.current.delete(item.id);
            }}
            defaultValue={item.text}
            onBlur={(e) => e.target.value !== item.text && update(item.id, { text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const text = e.currentTarget.value;
                const item2 = { id: newId(), text: '', done: false };
                const next = items.map((i) => (i.id === item.id ? { ...i, text } : i));
                next.splice(index + 1, 0, item2);
                onChange(next);
                requestAnimationFrame(() => refs.current.get(item2.id)?.focus());
              } else if (e.key === 'Backspace' && !e.currentTarget.value) {
                e.preventDefault();
                onChange(items.filter((i) => i.id !== item.id));
                const prev = items[index - 1];
                if (prev) requestAnimationFrame(() => refs.current.get(prev.id)?.focus());
              }
            }}
            className={`flex-1 bg-transparent text-sm outline-none ${item.done ? 'text-zinc-400 line-through' : ''}`}
            placeholder={t('task.checklistItem')}
          />
          <button type="button" aria-label={t('task.removeChecklistItem')} onClick={() => onChange(items.filter((i) => i.id !== item.id))} className="opacity-0 group-hover:opacity-50 hover:opacity-100">
            <X size={14} />
          </button>
        </li>
      ))}
      <li>
        <button type="button" onClick={() => insertAfter(items.length - 1)} className="py-1 text-sm text-zinc-400 hover:text-sky-600">
          {t('task.addChecklistItem')}
        </button>
      </li>
    </ul>
  );
}
