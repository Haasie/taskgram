import type { ModuleManifest } from '../types.js';

const manifest: ModuleManifest = {
  id: 'leesdossier',
  route: 'lezen',
  order: 10,
  title: { nl: 'Leesdossier', en: 'Reading file' },
  description: {
    nl: 'Leeslijst: nu lezend, wachtrij, backlog en uitgelezen boeken uit Postgram.',
    en: 'Reading list: current, queue, backlog and finished books from Postgram.'
  },
  icon: [
      'M12 5v16',
      'M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z'
    ],
  defaultEnabled: false,
  settings: [
    {
      key: 'categories',
      type: 'options',
      label: { nl: 'Categorieën', en: 'Categories' },
      help: {
        nl: 'Id (a-z, 0-9, -) en label. Boeken met een onbekende categorie vallen onder de laatste.',
        en: 'Id (a-z, 0-9, -) and label. Books with an unknown category fall under the last one.'
      },
      default: [
        { id: 'pol', label: { nl: 'Politiek & Geschiedenis', en: 'Politics & History' } },
        { id: 'fil', label: { nl: 'Filosofie & Psychologie', en: 'Philosophy & Psychology' } },
        { id: 'lead', label: { nl: 'Leiderschap & Business', en: 'Leadership & Business' } },
        { id: 'sec', label: { nl: 'Security & Techniek', en: 'Security & Technology' } },
        { id: 'fic', label: { nl: 'Fictie', en: 'Fiction' } },
        { id: 'reis', label: { nl: 'Reizen & Cultuur', en: 'Travel & Culture' } },
        { id: 'koken', label: { nl: 'Koken & Lifestyle', en: 'Cooking & Lifestyle' } },
        { id: 'ov', label: { nl: 'Overig', en: 'Other' } }
      ],
      maxItems: 16
    },
    { key: 'quarterGoal', type: 'number', label: { nl: 'Doel per kwartaal (boeken)', en: 'Goal per quarter (books)' }, default: 4, min: 0, max: 50, integer: true },
    {
      key: 'bookTag',
      type: 'string',
      label: { nl: 'Postgram-tag voor boeken', en: 'Postgram tag for books' },
      help: { nl: 'Boeken zijn documenten met deze tag. Wijzigen verbergt boeken met de oude tag.', en: 'Books are documents with this tag. Changing it hides books with the old tag.' },
      default: 'book',
      maxLength: 40
    },
    {
      key: 'exportPath',
      type: 'string',
      label: { nl: 'Doel van de Markdown-export', en: 'Markdown export target' },
      help: { nl: 'Getoond in het exportpaneel, bijv. het pad van je leeslijst in je vault.', en: 'Shown in the export panel, e.g. the path of your reading list in your vault.' },
      default: 'Leeslijst.md',
      maxLength: 200
    },
    { key: 'kicker', type: 'string', label: { nl: 'Regel boven de titel', en: 'Line above the title' }, default: 'Dossier', maxLength: 80 }
  ],
  env: [
    { name: 'KOSYNC_URL', description: { nl: 'KOReader-syncserver (optioneel), bijv. http://kosync:3000', en: 'KOReader sync server (optional), e.g. http://kosync:3000' } },
    { name: 'KOSYNC_USER', description: { nl: 'Gebruikersnaam op de syncserver', en: 'User name on the sync server' } },
    { name: 'KOSYNC_PASSWORD', secret: true, description: { nl: 'Wachtwoord op de syncserver', en: 'Password on the sync server' } },
    { name: 'KOSYNC_SYNC_MINUTES', description: { nl: 'Interval in minuten (standaard 15, 0 = alleen handmatig)', en: 'Interval in minutes (default 15, 0 = manual only)' } }
  ]
};

export default manifest;
