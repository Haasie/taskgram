import { useQuery } from '@tanstack/react-query';
import { lazy, useEffect, useRef, type ComponentType, type LazyExoticComponent } from 'react';
import { MODULES, moduleById } from './moduleRegistry';
import type { ModuleManifest, ModuleSettings, ModuleStates, ModuleViewProps } from '../../modules/types.js';
import { api, ApiError, request, type ModulesInfo } from './api';
import { queryClient } from './queries';
import { showToast } from './toast';
import { getLang } from '../i18n/index.js';

// Elke modules/<id>/client.tsx is een eigen chunk; die wordt pas geladen als de module open gaat.
const views = import.meta.glob<{ default: ComponentType<ModuleViewProps> }>('../../modules/*/client.tsx');

export type ClientModule = ModuleManifest & { View: LazyExoticComponent<ComponentType<ModuleViewProps>> };

export const CLIENT_MODULES: ClientModule[] = MODULES.flatMap((m) => {
  const load = views[`../../modules/${m.id}/client.tsx`];
  if (!load) {
    console.error(`[modules] modules/${m.id}/client.tsx ontbreekt`);
    return [];
  }
  return [{ ...m, View: lazy(load) }];
});

const MODULES_KEY = ['modules'] as const;

const useModulesInfo = () => useQuery({ queryKey: MODULES_KEY, queryFn: api.modules, staleTime: 60_000 });

/** Aan/uit per module; `data` is undefined zolang onbekend. */
export function useModuleStates() {
  const q = useModulesInfo();
  return { ...q, data: q.data?.modules as ModuleStates | undefined };
}

/** Instellingen van één module (standaardwaarden al ingevuld door de server). */
export function useModuleSettings(id: string): ModuleSettings | undefined {
  return useModulesInfo().data?.settings?.[id];
}

/** Instellingen opslaan; gooit bij een validatiefout met de meldingen per veld. */
export async function saveModuleSettings(id: string, values: ModuleSettings, reset: string[] = []) {
  try {
    const settings = await api.setModuleSettings(id, values, reset);
    queryClient.setQueryData<ModulesInfo>(MODULES_KEY, (old) => (old ? { ...old, settings: { ...old.settings, [id]: settings } } : old));
    return { ok: true as const };
  } catch (err) {
    const issues = err instanceof ApiError ? err.issues : undefined;
    return { ok: false as const, message: err instanceof Error ? err.message : '', issues };
  }
}

/** Ingeschakelde modules; zolang de status onbekend is: geen. */
export function useEnabledModules(): ClientModule[] {
  const { data } = useModuleStates();
  return data ? CLIENT_MODULES.filter((m) => data[m.id]) : [];
}

export async function setModuleEnabled(id: string, enabled: boolean) {
  const previous = queryClient.getQueryData<ModulesInfo>(MODULES_KEY);
  if (previous) queryClient.setQueryData<ModulesInfo>(MODULES_KEY, { ...previous, modules: { ...previous.modules, [id]: enabled } });
  try {
    const modules = await api.setModuleEnabled(id, enabled);
    queryClient.setQueryData<ModulesInfo>(MODULES_KEY, (old) => (old ? { ...old, modules } : { modules, settings: {} }));
    // Uit = ook geen achtergebleven moduledata in het geheugen.
    if (!enabled) queryClient.removeQueries({ queryKey: ['module', id] });
  } catch (err) {
    queryClient.setQueryData(MODULES_KEY, previous);
    showToast(`Module opslaan mislukt: ${err instanceof Error ? err.message : ''}`);
  }
}

export const moduleTitle = (m: ModuleManifest) => m.title[getLang()];
export const moduleDescription = (m: ModuleManifest) => m.description[getLang()];
export { moduleById };

export function ModuleIcon({ module, size = 16, className }: { module: ModuleManifest; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {module.icon.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * Modules met `startup: true` mogen bij de eerste keer openen per dag het scherm overnemen (bijv. een
 * ochtendritueel). Eén keer per dag per apparaat, en alleen vanaf het startscherm of Vandaag: een diepe link
 * (zoals een push naar een taak) gaat altijd voor.
 */
export function useStartupModule(routeKind: string, open: (id: string) => void) {
  const enabled = useEnabledModules();
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || enabled.length === 0) return;
    asked.current = true;
    if (routeKind !== 'home' && routeKind !== 'today') return;
    const candidate = enabled.find((m) => m.startup);
    if (!candidate) return;
    const key = `tg-startup-${candidate.id}`;
    void request<{ open: boolean; date?: string }>('GET', `/modules/${candidate.id}/startup`)
      .then((r) => {
        if (!r.open || !r.date) return;
        let seen: string | null = null;
        try {
          seen = localStorage.getItem(key);
          localStorage.setItem(key, r.date);
        } catch {
          // Geen opslag (privévenster): dan gewoon openen.
        }
        if (seen !== r.date) open(candidate.id);
      })
      .catch(() => {});
  }, [enabled, routeKind, open]);
}
