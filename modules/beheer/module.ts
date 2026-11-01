import type { ModuleManifest } from '../types.js';

const manifest: ModuleManifest = {
  id: 'beheer',
  route: 'beheer',
  order: 90,
  title: { nl: 'Beheer', en: 'Operations' },
  description: {
    nl: 'Stand van de homelab volgens de Homelab Supervisor: containers, opslag, back-up, restore-test en wat agents deden.',
    en: 'Homelab state from the Homelab Supervisor: containers, storage, backup, restore drill and what agents did.'
  },
  icon: ['M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2'],
  // Vraagt een eigen Homelab Supervisor (SUPERVISOR_URL/TOKEN); standaard uit.
  defaultEnabled: false,
  env: [
    { name: 'SUPERVISOR_URL', description: { nl: 'Adres van de Homelab Supervisor', en: 'Homelab Supervisor address' } },
    { name: 'SUPERVISOR_TOKEN', secret: true, description: { nl: 'Leestoken van /api/status', en: 'Read token for /api/status' } }
  ]
};

export default manifest;
