import type { Localized, ModuleManifest, ModuleSettings, ModuleStates, OptionItem, SettingDef } from './types.js';

/** Opgeslagen schakelaars over de standaardwaarden heen; onbekende ids vallen weg. */
export function resolveModuleStates(manifests: readonly ModuleManifest[], saved: Record<string, unknown>): ModuleStates {
  return Object.fromEntries(
    manifests.map((m) => [m.id, typeof saved[m.id] === 'boolean' ? (saved[m.id] as boolean) : m.defaultEnabled])
  );
}

/** Opgeslagen instellingen over de standaardwaarden heen; ongeldige of onbekende waarden vallen terug op de standaard. */
export function resolveSettings(defs: readonly SettingDef[] | undefined, saved: unknown): ModuleSettings {
  const src = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
  const out: ModuleSettings = {};
  for (const def of defs ?? []) {
    const checked = checkValue(def, src[def.key]);
    out[def.key] = checked.ok ? checked.value : def.default;
  }
  return out;
}

export type ValidationResult = { ok: true; values: ModuleSettings } | { ok: false; errors: Record<string, string> };

/** Valideert een (deel)wijziging; alleen bekende sleutels, elk volgens zijn definitie. */
export function validateSettings(defs: readonly SettingDef[] | undefined, input: unknown): ValidationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: { _: 'object verwacht' } };
  const byKey = new Map((defs ?? []).map((d) => [d.key, d]));
  const values: ModuleSettings = {};
  const errors: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const def = byKey.get(key);
    if (!def) {
      errors[key] = 'onbekende instelling';
      continue;
    }
    const checked = checkValue(def, value);
    if (checked.ok) values[key] = checked.value;
    else errors[key] = checked.error;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, values };
}

type Checked = { ok: true; value: unknown } | { ok: false; error: string };

function checkValue(def: SettingDef, value: unknown): Checked {
  if (value === undefined) return { ok: false, error: 'ontbreekt' };
  switch (def.type) {
    case 'string': {
      if (typeof value !== 'string') return { ok: false, error: 'tekst verwacht' };
      const v = value.trim();
      if (v.length > (def.maxLength ?? 300)) return { ok: false, error: 'te lang' };
      return { ok: true, value: v };
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, error: 'getal verwacht' };
      if (def.integer && !Number.isInteger(value)) return { ok: false, error: 'geheel getal verwacht' };
      if (def.min !== undefined && value < def.min) return { ok: false, error: `minimaal ${def.min}` };
      if (def.max !== undefined && value > def.max) return { ok: false, error: `maximaal ${def.max}` };
      return { ok: true, value };
    }
    case 'boolean':
      return typeof value === 'boolean' ? { ok: true, value } : { ok: false, error: 'aan/uit verwacht' };
    case 'options': {
      if (!Array.isArray(value) || value.length === 0) return { ok: false, error: 'minstens één item' };
      if (value.length > (def.maxItems ?? 30)) return { ok: false, error: 'te veel items' };
      const ids = new Set<string>();
      const items: OptionItem[] = [];
      for (const item of value) {
        const id = typeof item?.id === 'string' ? item.id.trim() : '';
        const label = typeof item?.label === 'string' ? item.label.trim() : '';
        if (!/^[a-z0-9-]{1,24}$/.test(id)) return { ok: false, error: `ongeldige id "${id}" (a-z, 0-9, -)` };
        if (!label || label.length > 60) return { ok: false, error: `label ontbreekt of is te lang bij "${id}"` };
        if (ids.has(id)) return { ok: false, error: `dubbele id "${id}"` };
        ids.add(id);
        items.push({ id, label });
      }
      return { ok: true, value: items };
    }
  }
}

/** Label in de huidige taal (standaardwaarden kunnen per taal zijn, eigen invoer is platte tekst). */
export const localize = (label: string | Localized, lang: 'nl' | 'en') => (typeof label === 'string' ? label : label[lang]);

export const optionList = (value: unknown): OptionItem[] => (Array.isArray(value) ? (value as OptionItem[]) : []);
