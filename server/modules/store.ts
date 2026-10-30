import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveModuleStates, type ModuleStates } from '../../modules/registry.js';

export type ModuleStore = ReturnType<typeof createModuleStore>;

/** Aan/uit per module, naast push.json in DATA_DIR. */
export function createModuleStore(dir: string) {
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'modules.json');

  function load(): Record<string, unknown> {
    if (!existsSync(filePath)) return {};
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
      return parsed && typeof parsed.enabled === 'object' && parsed.enabled ? parsed.enabled : {};
    } catch {
      return {};
    }
  }

  let saved = load();

  return {
    states(): ModuleStates {
      return resolveModuleStates(saved);
    },
    isEnabled(id: string): boolean {
      return resolveModuleStates(saved)[id] === true;
    },
    setEnabled(id: string, enabled: boolean): ModuleStates {
      saved = { ...saved, [id]: enabled };
      const tmpPath = join(dir, `modules.json.tmp.${randomUUID()}`);
      writeFileSync(tmpPath, JSON.stringify({ enabled: saved }, null, 2), 'utf-8');
      renameSync(tmpPath, filePath);
      return resolveModuleStates(saved);
    }
  };
}
