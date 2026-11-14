import type { ModuleManifest } from '../types.js';

const minutes = (key: string, nl: string, en: string, def: number, helpNl?: string, helpEn?: string) => ({
  key,
  type: 'number' as const,
  label: { nl, en },
  ...(helpNl ? { help: { nl: helpNl, en: helpEn ?? helpNl } } : {}),
  default: def,
  min: 0,
  max: 960,
  integer: true
});

const manifest: ModuleManifest = {
  id: 'dagplanning',
  route: 'dagplanning',
  order: 5,
  title: { nl: 'Dagplanning', en: 'Day planning' },
  description: {
    nl: 'Ochtend plannen en avond afsluiten, met een capaciteitscheck die leert van wat je echt afkrijgt. Je schat zelf niets: AI of een vaste regel doet de eerste schatting, je eigen dagplannen corrigeren hem.',
    en: 'Plan in the morning and close in the evening, with a capacity check that learns from what you actually finish. You never estimate yourself: AI or a fixed rule makes the first guess, your own day plans correct it.'
  },
  icon: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M9 16l2 2 4-4'],
  defaultEnabled: false,
  startup: true,
  settings: [
    minutes('workMinutes', 'Werktijd voor taken op een normale werkdag (min)', 'Work time for tasks on a normal workday (min)', 300, 'Tijd die overblijft naast afspraken. Begin laag: de correctie doet de rest.', 'Time left next to meetings. Start low: the correction does the rest.'),
    minutes('workBusyMinutes', 'Werktijd op een drukke dag (min)', 'Work time on a busy day (min)', 120),
    minutes('personalWeekdayMinutes', 'Privétijd op een doordeweekse dag (min)', 'Personal time on a weekday (min)', 90),
    minutes('personalWeekendMinutes', 'Privétijd op een weekenddag (min)', 'Personal time on a weekend day (min)', 240),
    {
      key: 'agentAttentionMinutes',
      type: 'number',
      label: { nl: 'Aandacht per agenttaak (min)', en: 'Attention per agent task (min)' },
      help: {
        nl: 'Een agent doet het werk; jij start en reviewt. Alleen die tijd telt mee.',
        en: 'An agent does the work; you kick off and review. Only that time counts.'
      },
      default: 20,
      min: 5,
      max: 120,
      integer: true
    },
    {
      key: 'maxParallelAgents',
      type: 'number',
      label: { nl: 'Maximaal agents tegelijk', en: 'Maximum agents at once' },
      help: { nl: 'Meer agents is meer schakelen. Daarboven vraagt de planning om bevestiging.', en: 'More agents means more switching. Above this the plan asks for confirmation.' },
      default: 3,
      min: 1,
      max: 10,
      integer: true
    },
    { key: 'agentTag', type: 'string', label: { nl: 'Tag voor agenttaken', en: 'Tag for agent tasks' }, default: 'agent', maxLength: 40 },
    {
      key: 'startFactor',
      type: 'number',
      label: { nl: 'Startcorrectie', en: 'Starting correction' },
      help: {
        nl: 'Vermenigvuldiger op schattingen tot er 5 afgesloten dagen zijn; daarna leert de module hem zelf (1–3).',
        en: 'Multiplier on estimates until there are 5 closed days; after that the module learns it (1–3).'
      },
      default: 1.5,
      min: 1,
      max: 3
    },
    {
      key: 'aiEstimates',
      type: 'boolean',
      label: { nl: 'AI-schattingen', en: 'AI estimates' },
      help: {
        nl: 'Stuurt alleen de titel (eerste regel) van taken zonder schatting naar Claude. Werkt alleen met ANTHROPIC_API_KEY.',
        en: 'Sends only the title (first line) of tasks without an estimate to Claude. Needs ANTHROPIC_API_KEY.'
      },
      default: true
    },
    {
      key: 'autoOpen',
      type: 'boolean',
      label: { nl: 'Ritueel openen bij eerste keer per dag', en: 'Open the ritual on first launch each day' },
      default: true
    }
  ],
  env: [
    { name: 'ANTHROPIC_API_KEY', secret: true, description: { nl: 'Voor AI-schattingen (optioneel; zonder sleutel alleen de vaste regel).', en: 'For AI estimates (optional; without it only the fixed rule).' } },
    { name: 'DAGPLANNING_MODEL', description: { nl: 'Claude-model voor schattingen (standaard claude-opus-5-5).', en: 'Claude model for estimates (default claude-opus-5-5).' } }
  ]
};

export default manifest;
