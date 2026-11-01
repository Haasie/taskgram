import type { SettingDef } from './types.js';

/** Gedeeld door de modules Werkradar en Privéradar (geen module: er is geen module.ts in deze map). */
export const RADAR_ICON = [
  'M19.07 4.93A10 10 0 0 0 6.99 3.34',
  'M4 6h.01',
  'M2.29 9.62A10 10 0 1 0 21.31 8.35',
  'M16.24 7.76A6 6 0 1 0 8.23 16.67',
  'M12 18h.01',
  'M17.99 11.66A6 6 0 0 1 15.77 16.67',
  'M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
  'm13.41 10.59 5.66-5.66'
];

export const radarSettings = (defaultTag: string): SettingDef[] => [
  {
    key: 'tag',
    type: 'string',
    label: { nl: 'Postgram-tag voor projectkaarten', en: 'Postgram tag for project cards' },
    help: { nl: 'Projecten in dit gebied met deze tag worden kaarten.', en: 'Projects in this area with this tag become cards.' },
    default: defaultTag,
    maxLength: 40
  },
  {
    key: 'staleDays',
    type: 'number',
    label: { nl: 'Inbox-taak telt als oud na (dagen)', en: 'Inbox task counts as stale after (days)' },
    default: 28,
    min: 1,
    max: 365,
    integer: true
  }
];
