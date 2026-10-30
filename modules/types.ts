/**
 * Eén module = één entry in modules/registry.ts plus één map modules/<id>/ met:
 *   client.tsx  (verplicht) default export: de weergave, lazy geladen
 *   server.ts   (optioneel) export `routes(pg)`: API onder /api/modules/<id>/… (zie server/modules/routes.ts)
 * Een uitgeschakelde module heeft geen route, geen menu-item en de server weigert zijn API.
 */
export type ModuleManifest = {
  /** Stabiel: gebruikt in opslag, API-pad en mapnaam. */
  id: string;
  /** Hash-pad zonder #/, bijv. 'lezen' → #/lezen. */
  route: string;
  title: { nl: string; en: string };
  description: { nl: string; en: string };
  /** SVG-paden (24×24, lucide-stijl) zodat het icoon in de registry zelf staat. */
  icon: string[];
  defaultEnabled: boolean;
};

export type ModuleViewProps = { today: string };
