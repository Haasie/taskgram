import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { ModuleManifest, ModuleSettings, OptionItem, SettingDef } from '../../modules/types.js';
import { localize } from '../../modules/settings.js';
import { saveModuleSettings } from '../lib/modules';
import { showToast } from '../lib/toast';
import { t, useLang } from '../i18n/index.js';

/** Formulier op basis van het instellingenschema in het manifest van een module. */
export function ModuleSettingsForm({ module, current }: { module: ModuleManifest; current: ModuleSettings | undefined }) {
  const lang = useLang();
  const defs = module.settings ?? [];
  const [draft, setDraft] = useState<ModuleSettings>(() => toDraft(defs, current, lang));
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(toDraft(defs, current, lang)), [current, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (reset: string[] = []) => {
    setBusy(true);
    const values = reset.length ? {} : draft;
    const res = await saveModuleSettings(module.id, values, reset);
    setBusy(false);
    if (res.ok) {
      setIssues({});
      showToast(t('modules.saved'));
    } else {
      setIssues(res.issues ?? {});
      showToast(t('modules.saveFailed', { error: res.message }));
    }
  };

  return (
    <div className="space-y-3 pt-2">
      {defs.map((def) => (
        <SettingField key={def.key} def={def} lang={lang} value={draft[def.key]} issue={issues[def.key]} onChange={(v) => setDraft((d) => ({ ...d, [def.key]: v }))} moduleId={module.id} />
      ))}
      {module.env?.length ? (
        <div className="rounded-md bg-zinc-50 p-2 text-xs text-zinc-500 dark:bg-zinc-800/50">
          <p className="mb-1 font-medium">{t('modules.env')}</p>
          <ul className="space-y-0.5">
            {module.env.map((e) => (
              <li key={e.name}>
                <code className="font-mono">{e.name}</code>
                {e.secret ? ` (${t('modules.envSecret')})` : ''} — {localize(e.description, lang)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {defs.length > 0 && (
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {t('modules.save')}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void save(defs.map((d) => d.key))}>
            {t('modules.reset')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Opties uit de standaardwaarde (per taal) worden voor bewerken platte tekst in de huidige taal. */
function toDraft(defs: SettingDef[], current: ModuleSettings | undefined, lang: 'nl' | 'en'): ModuleSettings {
  const out: ModuleSettings = {};
  for (const def of defs) {
    const v = current?.[def.key] ?? def.default;
    out[def.key] = def.type === 'options' ? (v as OptionItem[]).map((o) => ({ id: o.id, label: localize(o.label, lang) })) : v;
  }
  return out;
}

function SettingField({ def, lang, value, issue, onChange, moduleId }: { def: SettingDef; lang: 'nl' | 'en'; value: unknown; issue?: string; onChange: (v: unknown) => void; moduleId: string }) {
  const id = `ms-${moduleId}-${def.key}`;
  const label = localize(def.label, lang);
  const help = def.help ? localize(def.help, lang) : '';
  return (
    <div className="field">
      {def.type === 'boolean' ? (
        <label className="flex items-center gap-2 text-sm">
          <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="size-4" />
          {label}
        </label>
      ) : (
        <label htmlFor={id} className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
          {label}
        </label>
      )}
      {def.type === 'string' && <input id={id} className="input" value={String(value ?? '')} maxLength={def.maxLength ?? 300} onChange={(e) => onChange(e.target.value)} />}
      {def.type === 'number' && (
        <input id={id} className="input" type="number" min={def.min} max={def.max} step={def.integer ? 1 : 'any'} value={Number(value ?? 0)} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />
      )}
      {def.type === 'options' && <OptionsEditor id={id} items={(value as OptionItem[]) ?? []} onChange={onChange} />}
      {help && <p className="text-xs text-zinc-500">{help}</p>}
      {issue && (
        <p className="text-xs text-rose-600" role="alert">
          ✕ {issue}
        </p>
      )}
    </div>
  );
}

function OptionsEditor({ id, items, onChange }: { id: string; items: OptionItem[]; onChange: (v: OptionItem[]) => void }) {
  const update = (i: number, patch: Partial<{ id: string; label: string }>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <div id={id} className="space-y-1" role="group">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-1">
          <input className="input w-24 font-mono" aria-label={`${t('modules.optionId')} ${i + 1}`} value={it.id} onChange={(e) => update(i, { id: e.target.value })} />
          <input className="input flex-1" aria-label={`${t('modules.optionLabel')} ${i + 1}`} value={String(it.label)} onChange={(e) => update(i, { label: e.target.value })} />
          <button type="button" className="icon-btn" aria-label={t('modules.up')} disabled={i === 0} onClick={() => move(i, -1)}>
            <ArrowUp size={14} />
          </button>
          <button type="button" className="icon-btn" aria-label={t('modules.down')} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
            <ArrowDown size={14} />
          </button>
          <button type="button" className="icon-btn text-rose-600" aria-label={t('modules.remove')} disabled={items.length <= 1} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" className="btn flex items-center gap-1 text-xs" onClick={() => onChange([...items, { id: '', label: '' }])}>
        <Plus size={13} /> {t('modules.add')}
      </button>
    </div>
  );
}
