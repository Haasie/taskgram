import { createContext, useContext } from 'react';
import type { Project, Task } from '../../shared/types';
import type { PickerState } from './WhenPicker';
import { t } from '../i18n/index.js';

export type Ui = {
  today: string;
  projects: Project[];
  projectsById: Map<string, Project>;
  allTags: string[];
  selectedId: string | null;
  expandedId: string | null;
  select: (id: string | null) => void;
  expand: (id: string | null) => void;
  openPicker: (state: NonNullable<PickerState>) => void;
  complete: (task: Task) => void;
};

export const UiContext = createContext<Ui | null>(null);

export function useUi(): Ui {
  const ui = useContext(UiContext);
  if (!ui) throw new Error('UiContext missing');
  return ui;
}

export function projectTitle(p: { content: string }) {
  const first = (p.content.split('\n')[0] ?? '').replace(/^#+\s*/, '').replace(/^Project:\s*/i, '').trim();
  // Lange beschrijvingen inkorten tot het deel vóór de eerste gedachtestreep of zin.
  const short = first.length > 48 ? first.split(/\s[—–-]\s|:\s|\.\s/)[0]! : first;
  return short || t('project.untitled');
}

/** Projecten die als lijst getoond worden: actief, of met open taken. Overige project-entiteiten zijn kennis. */
export function isListedProject(p: { id: string; status: string | null }, tasksProjectIds: Set<string>) {
  return p.status === 'active' || (p.status !== 'done' && tasksProjectIds.has(p.id));
}
