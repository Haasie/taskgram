import type { ModuleManifest } from '../types.js';
import { RADAR_ICON, radarSettings } from '../radar-shared.js';

const manifest: ModuleManifest = {
  id: 'werkradar',
  route: 'radar/work',
  area: 'work',
  order: 20,
  title: { nl: 'Werkradar', en: 'Work radar' },
  description: {
    nl: 'Projectkaarten met de radar-tag: status, fase, volgende stap, deadline en open taken.',
    en: 'Project cards with the radar tag: status, phase, next step, deadline and open tasks.'
  },
  icon: RADAR_ICON,
  // Bestond al vóór het modulesysteem; standaard aan zodat er na een update niets verdwijnt.
  defaultEnabled: true,
  settings: radarSettings('werkradar')
};

export default manifest;
