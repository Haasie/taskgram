import type { ModuleManifest } from './types.js';

const RADAR_ICON = [
  'M19.07 4.93A10 10 0 0 0 6.99 3.34',
  'M4 6h.01',
  'M2.29 9.62A10 10 0 1 0 21.31 8.35',
  'M16.24 7.76A6 6 0 1 0 8.23 16.67',
  'M12 18h.01',
  'M17.99 11.66A6 6 0 0 1 15.77 16.67',
  'M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
  'm13.41 10.59 5.66-5.66'
];

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
  },
  {
    id: 'werkradar',
    route: 'radar/work',
    area: 'work',
    title: { nl: 'Werkradar', en: 'Work radar' },
    description: {
      nl: 'Projectkaarten met tag werkradar: status, fase, volgende stap, deadline en open taken.',
      en: 'Project cards tagged werkradar: status, phase, next step, deadline and open tasks.'
    },
    icon: RADAR_ICON,
    // Bestond al vóór het modulesysteem; standaard aan zodat er na een update niets verdwijnt.
    defaultEnabled: true
  },
  {
    id: 'priveradar',
    route: 'radar/personal',
    area: 'personal',
    title: { nl: 'Privéradar', en: 'Personal radar' },
    description: {
      nl: 'Projectkaarten met tag priveradar: status, fase, volgende stap, deadline en open taken.',
      en: 'Project cards tagged priveradar: status, phase, next step, deadline and open tasks.'
    },
    icon: RADAR_ICON,
    defaultEnabled: true
  },
  {
    id: 'beheer',
    route: 'beheer',
    title: { nl: 'Beheer', en: 'Operations' },
    description: {
      nl: 'Stand van de homelab volgens de Homelab Supervisor: containers, opslag, back-up, restore-test en wat agents deden.',
      en: 'Homelab state from the Homelab Supervisor: containers, storage, backup, restore drill and what agents did.'
    },
    icon: ['M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2'],
    // Vraagt een eigen Homelab Supervisor (SUPERVISOR_URL/TOKEN); standaard uit.
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
