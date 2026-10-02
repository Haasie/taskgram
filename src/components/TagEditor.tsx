import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { t, useLang } from '../i18n/index.js';

export function TagEditor({ tags, allTags, onChange }: { tags: string[]; allTags: string[]; onChange: (tags: string[]) => void }) {
  useLang();
  const [draft, setDraft] = useState('');
  const listId = useId();

  const add = (raw: string) => {
    const tag = raw.trim().replace(/^#/, '').toLowerCase();
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
    setDraft('');
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span key={tag} className="tag inline-flex items-center gap-1">
          {tag}
          <button type="button" aria-label={t('task.removeTag', { tag })} onClick={() => onChange(tags.filter((t) => t !== tag))} className="opacity-60 hover:opacity-100">
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        list={listId}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && tags.length) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={() => draft && add(draft)}
        placeholder={t('task.addTag')}
        className="min-w-20 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
      />
      <datalist id={listId}>
        {allTags.filter((t) => !tags.includes(t)).map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  );
}
