import { useQuery } from '@tanstack/react-query';
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { MODULES, moduleById } from '../../modules/registry.js';
import type { ModuleManifest, ModuleViewProps } from '../../modules/types.js';
import { api } from './api';
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

export const useModuleStates = () =>
  useQuery({ queryKey: MODULES_KEY, queryFn: api.modules, staleTime: 60_000 });

/** Ingeschakelde modules; zolang de status onbekend is: geen. */
export function useEnabledModules(): ClientModule[] {
  const { data } = useModuleStates();
  return data ? CLIENT_MODULES.filter((m) => data[m.id]) : [];
}

export async function setModuleEnabled(id: string, enabled: boolean) {
  const previous = queryClient.getQueryData<Record<string, boolean>>(MODULES_KEY);
  queryClient.setQueryData(MODULES_KEY, { ...previous, [id]: enabled });
  try {
    queryClient.setQueryData(MODULES_KEY, await api.setModuleEnabled(id, enabled));
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
