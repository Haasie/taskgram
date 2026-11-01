import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveModuleStates, resolveSettings } from '../../modules/settings.js';
import type { ModuleManifest, ModuleSettings, ModuleStates } from '../../modules/types.js';

export type ModuleStore = ReturnType<typeof createModuleStore>;

type Saved = { enabled: Record<string, unknown>; settings: Record<string, Record<string, unknown>> };

/** Aan/uit en (niet-geheime) instellingen per module, naast push.json in DATA_DIR. */
export function createModuleStore(dir: string, manifests: readonly ModuleManifest[]) {
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'modules.json');

  function load(): Saved {
    if (!existsSync(filePath)) return { enabled: {}, settings: {} };
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
      const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, never>) : {});
      return { enabled: obj(parsed?.enabled), settings: obj(parsed?.settings) };
    } catch {
      return { enabled: {}, settings: {} };
    }
  }

  let saved = load();
  const byId = (id: string) => manifests.find((m) => m.id === id);

  function persist() {
    const tmpPath = join(dir, `modules.json.tmp.${randomUUID()}`);
    writeFileSync(tmpPath, JSON.stringify(saved, null, 2), 'utf-8');
    renameSync(tmpPath, filePath);
  }

  return {
    states(): ModuleStates {
      return resolveModuleStates(manifests, saved.enabled);
    },
    isEnabled(id: string): boolean {
      return resolveModuleStates(manifests, saved.enabled)[id] === true;
    },
    setEnabled(id: string, enabled: boolean): ModuleStates {
      saved = { ...saved, enabled: { ...saved.enabled, [id]: enabled } };
      persist();
      return this.states();
    },
    /** Instellingen met standaardwaarden ingevuld. */
    settings(id: string): ModuleSettings {
      return resolveSettings(byId(id)?.settings, saved.settings[id]);
    },
    allSettings(): Record<string, ModuleSettings> {
      return Object.fromEntries(manifests.map((m) => [m.id, this.settings(m.id)]));
    },
    /** Al gevalideerde (deel)wijziging; `null` per sleutel zet terug naar de standaard. */
    setSettings(id: string, values: ModuleSettings, reset: string[] = []): ModuleSettings {
      const current = { ...(saved.settings[id] ?? {}), ...values };
      for (const key of reset) delete current[key];
      saved = { ...saved, settings: { ...saved.settings, [id]: current } };
      persist();
      return this.settings(id);
    }
  };
}
