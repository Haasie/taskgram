/**
 * Eén module = één map modules/<id>/ met:
 *   module.ts   (verplicht) default export: het ModuleManifest hieronder — zo wordt de module gevonden
 *   client.tsx  (verplicht) default export: de weergave, lazy geladen
 *   server.ts   (optioneel) export `routes(ctx)` (API onder /api/modules/<id>/…) en eventueel `start(ctx)`
 *               voor achtergrondwerk; zie ModuleContext in server/modules/routes.ts
 * Er is geen centrale lijst: een map met module.ts is een module. Zo kan een eigen build (overlay)
 * modules toevoegen zonder de core aan te passen. Zie docs/modules/README.md.
 * Een uitgeschakelde module heeft geen route, geen menu-item en de server weigert zijn API.
 */

export type Localized = { nl: string; en: string };

/** Keuzelijst-item (bijv. een categorie); labels in de standaardwaarde mogen per taal. */
export type OptionItem = { id: string; label: string | Localized };

/**
 * Instelling van een module (niet-geheim; geheimen blijven env-variabelen).
 * Aanpasbaar in Instellingen → Modules, opgeslagen op de server naast de schakelaars.
 */
export type SettingDef =
  | { key: string; type: 'string'; label: Localized; help?: Localized; default: string; maxLength?: number }
  | { key: string; type: 'number'; label: Localized; help?: Localized; default: number; min?: number; max?: number; integer?: boolean }
  | { key: string; type: 'boolean'; label: Localized; help?: Localized; default: boolean }
  | { key: string; type: 'options'; label: Localized; help?: Localized; default: OptionItem[]; maxItems?: number };

export type ModuleSettings = Record<string, unknown>;

export type ModuleManifest = {
  /** Stabiel en gelijk aan de mapnaam: gebruikt in opslag en API-pad. */
  id: string;
  /** Hash-pad zonder #/, bijv. 'lezen' → #/lezen (mag een / bevatten, bijv. 'radar/work'). */
  route: string;
  /** Plek in het menu: onder dit gebied in plaats van in het modulesblok. */
  area?: 'work' | 'personal';
  /** Volgorde in menu en instellingen (laag eerst); standaard 100. */
  order?: number;
  title: Localized;
  description: Localized;
  /** SVG-paden (24×24, lucide-stijl) zodat het icoon in het manifest zelf staat. */
  icon: string[];
  defaultEnabled: boolean;
  settings?: SettingDef[];
  /** Env-variabelen die de module leest (alleen ter documentatie in de UI; waarden blijven op de server). */
  env?: { name: string; secret?: boolean; description: Localized }[];
};

export type ModuleStates = Record<string, boolean>;

export type ModuleViewProps = { today: string; settings: ModuleSettings };
