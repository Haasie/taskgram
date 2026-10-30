import type { ModuleManifest } from './types.js';

/** Alle modules. Een nieuwe module: één entry hier en een map modules/<id>/ (zie types.ts). */
export const MODULES: readonly ModuleManifest[] = [
  {
    id: 'leesdossier',
    route: 'lezen',
    title: { nl: 'Leesdossier', en: 'Reading file' },
    description: {
      nl: 'Leeslijst: nu lezend, wachtrij, backlog en uitgelezen boeken uit Postgram.',
      en: 'Reading list: current, queue, backlog and finished books from Postgram.'
    },
    icon: [
      'M12 5v16',
      'M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z'
    ],
    defaultEnabled: false
  }
];

export const moduleById = (id: string) => MODULES.find((m) => m.id === id);
export const moduleByRoute = (route: string) => MODULES.find((m) => m.route === route);

export type ModuleStates = Record<string, boolean>;

/** Opgeslagen schakelaars over de standaardwaarden heen; onbekende ids vallen weg. */
export function resolveModuleStates(saved: Record<string, unknown>): ModuleStates {
  return Object.fromEntries(
    MODULES.map((m) => [m.id, typeof saved[m.id] === 'boolean' ? (saved[m.id] as boolean) : m.defaultEnabled])
  );
}
