import { existsSync, readdirSync } from 'node:fs';
import type { ModuleManifest } from '../../modules/types.js';

/**
 * Elke map in modules/ met een module.ts (gecompileerd: module.js) is een module.
 * Geen centrale lijst, zodat een overlay-build modules kan toevoegen zonder de core aan te passen.
 * Werkt vanuit de bron (tsx/vitest: ../../modules → modules/) en vanuit dist-server (→ dist-server/modules/).
 */
const root = new URL('../../modules/', import.meta.url);

const has = (dir: string, file: string) => existsSync(new URL(`${dir}/${file}.js`, root)) || existsSync(new URL(`${dir}/${file}.ts`, root));

async function discover(): Promise<{ manifests: ModuleManifest[]; withServer: Set<string> }> {
  const manifests: ModuleManifest[] = [];
  const withServer = new Set<string>();
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !has(entry.name, 'module')) continue;
    const manifest = ((await import(/* @vite-ignore */ `../../modules/${entry.name}/module.js`)) as { default: ModuleManifest }).default;
    if (manifest.id !== entry.name) throw new Error(`modules/${entry.name}/module.ts: id "${manifest.id}" moet gelijk zijn aan de mapnaam`);
    manifests.push(manifest);
    if (has(entry.name, 'server')) withServer.add(entry.name);
  }
  manifests.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id));
  const routes = new Set<string>();
  for (const m of manifests) {
    if (routes.has(m.route)) throw new Error(`Twee modules met route "${m.route}"`);
    routes.add(m.route);
  }
  return { manifests, withServer };
}

export const { manifests: MODULES, withServer: MODULES_WITH_SERVER } = await discover();
export const moduleById = (id: string) => MODULES.find((m) => m.id === id);
