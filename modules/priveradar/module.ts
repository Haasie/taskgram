import type { ModuleManifest } from '../types.js';
import { RADAR_ICON, radarSettings } from '../radar-shared.js';

const manifest: ModuleManifest = {
  id: 'priveradar',
  route: 'radar/personal',
  area: 'personal',
  order: 21,
  title: { nl: 'Privéradar', en: 'Personal radar' },
  description: {
    nl: 'Projectkaarten met de radar-tag: status, fase, volgende stap, deadline en open taken.',
    en: 'Project cards with the radar tag: status, phase, next step, deadline and open tasks.'
  },
  icon: RADAR_ICON,
  defaultEnabled: true,
  settings: radarSettings('priveradar')
};

export default manifest;
