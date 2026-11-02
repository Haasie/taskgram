import type { ModuleManifest } from '../types.js';

const manifest: ModuleManifest = {
  id: 'cockpit',
  route: 'cockpit',
  order: 30,
  title: { nl: 'Cockpit', en: 'Cockpit' },
  description: {
    nl: 'Waar je aan bouwt: features per fase, de werkplekken en branches erachter, open risico’s (niet gepusht, vuil, ontbrekend) en agent-sessies om te hervatten.',
    en: 'What you are building: features per stage, the workspaces and branches behind them, open risks (unpushed, dirty, missing) and agent sessions to resume.'
  },
  icon: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M12 12l4-4', 'M12 7v1', 'M7 12h1', 'M16 12h1'],
  // Vraagt een Postgram met workspace-tracking (GET /api/where); standaard uit.
  defaultEnabled: false,
  settings: [
    {
      key: 'actionsView',
      type: 'boolean',
      label: { nl: 'Ordenen op actie', en: 'Group by action' },
      help: {
        nl: 'Aan: review, test, merge en release eerst, lopend werk daarna. Uit: op fase.',
        en: 'On: review, test, merge and release first, work in progress after. Off: by stage.'
      },
      default: false
    },
    { key: 'includeReleased', type: 'boolean', label: { nl: 'Uitgerolde features tonen', en: 'Show released features' }, default: false },
    {
      key: 'machine',
      type: 'string',
      label: { nl: 'Alleen deze machine', en: 'Only this machine' },
      help: { nl: 'Machine-alias uit pgm (leeg = alle machines).', en: 'Machine alias from pgm (empty = all machines).' },
      default: '',
      maxLength: 60
    }
  ]
};

export default manifest;
