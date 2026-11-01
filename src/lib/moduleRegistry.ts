import type { ModuleManifest } from '../../modules/types.js';

// Elke modules/<id>/module.ts is een module (zie modules/types.ts); geen centrale lijst.
const found = import.meta.glob<{ default: ModuleManifest }>('../../modules/*/module.ts', { eager: true });

export const MODULES: ModuleManifest[] = Object.entries(found)
  .map(([path, mod]) => {
    const dir = path.split('/').at(-2);
    if (mod.default.id !== dir) console.error(`[modules] ${path}: id "${mod.default.id}" moet gelijk zijn aan de mapnaam`);
    return mod.default;
  })
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id));

export const moduleById = (id: string) => MODULES.find((m) => m.id === id);
export const moduleByRoute = (route: string) => MODULES.find((m) => m.route === route);
