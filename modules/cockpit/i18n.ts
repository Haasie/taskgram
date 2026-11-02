import { useLang } from '../../src/i18n/index.js';
import type { Level, Risk } from './logic';

const nl = {
  kicker: 'Postgram · werkplekken',
  title: 'Cockpit',
  lede: 'Waar je aan bouwt, waar het ligt en wat nog niet veilig op de remote staat.',
  refresh: '⟳ Ververs',
  refreshing: 'Laden…',
  generated: 'Stand van {time}',
  loading: 'Werkplekken ophalen uit Postgram…',
  loadFailed: 'Postgram gaf geen werkplekken: {error}',
  notSupported: 'Deze Postgram kent geen workspace-tracking (GET /api/where). Zet pgm here/scan op je machines en werk Postgram bij.',
  tilesAria: 'Risico’s',
  tileFeatures: 'Features',
  empty: 'Niets in deze fase.',
  unassigned: 'Zonder feature',
  noWorkspace: 'Geen werkplek gekoppeld.',
  lastActive: 'actief {time}',
  missingSince: 'weg sinds {time}',
  resume: 'Hervat',
  copy: 'Kopieer',
  copied: 'Gekopieerd',
  sessions: '{n} sessie(s)',
  pr: 'PR {state}'
};

const en: typeof nl = {
  kicker: 'Postgram · workspaces',
  title: 'Cockpit',
  lede: 'What you are building, where it lives and what is not safely on the remote yet.',
  refresh: '⟳ Refresh',
  refreshing: 'Loading…',
  generated: 'As of {time}',
  loading: 'Fetching workspaces from Postgram…',
  loadFailed: 'Postgram returned no workspaces: {error}',
  notSupported: 'This Postgram has no workspace tracking (GET /api/where). Set up pgm here/scan on your machines and update Postgram.',
  tilesAria: 'Risks',
  tileFeatures: 'Features',
  empty: 'Nothing in this stage.',
  unassigned: 'Without a feature',
  noWorkspace: 'No workspace linked.',
  lastActive: 'active {time}',
  missingSince: 'gone since {time}',
  resume: 'Resume',
  copy: 'Copy',
  copied: 'Copied',
  sessions: '{n} session(s)',
  pr: 'PR {state}'
};

type Key = keyof typeof nl;

const RISK: Record<'nl' | 'en', Record<Risk, string>> = {
  nl: { dirty: 'Niet gecommit', unpushed: 'Niet gepusht', no_upstream: 'Geen remote', interrupted: 'Afgebroken', missing: 'Ontbreekt' },
  en: { dirty: 'Uncommitted', unpushed: 'Unpushed', no_upstream: 'No upstream', interrupted: 'Interrupted', missing: 'Missing' }
};

const GROUP: Record<'nl' | 'en', Record<string, string>> = {
  nl: {
    building: 'Bouwen', review: 'Review', functional_test: 'Functioneel testen', ready_to_merge: 'Klaar om te mergen',
    awaiting_release: 'Wacht op release', released: 'Uitgerold', test: 'Testen', merge: 'Mergen', release: 'Uitrollen', in_progress: 'Onderhanden'
  },
  en: {
    building: 'Building', review: 'Review', functional_test: 'Functional test', ready_to_merge: 'Ready to merge',
    awaiting_release: 'Awaiting release', released: 'Released', test: 'Test', merge: 'Merge', release: 'Release', in_progress: 'In progress'
  }
};

const LEVEL: Record<'nl' | 'en', Record<Level, string>> = {
  nl: { ok: 'Veilig', warn: 'Let op', alert: 'Alarm' },
  en: { ok: 'Safe', warn: 'Attention', alert: 'Alarm' }
};

/** Vertaalfunctie voor deze module; volgt de taalkeuze van Taskgram. */
export function useT() {
  const lang = useLang();
  const dict = lang === 'en' ? en : nl;
  const t = (key: Key, vars?: Record<string, string | number>) =>
    dict[key].replace(/\{(\w+)\}/g, (_, v: string) => String(vars?.[v] ?? `{${v}}`));
  return { t, lang, risk: (r: Risk) => RISK[lang][r], group: (key: string, fallback: string) => GROUP[lang][key] ?? fallback, level: (l: Level) => LEVEL[lang][l], locale: lang === 'en' ? 'en-GB' : 'nl-NL' };
}
