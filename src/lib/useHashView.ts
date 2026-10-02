import { useCallback, useEffect, useState } from 'react';
import type { Visibility } from '../../shared/types';
import type { ListKind, View } from './lists';

const LISTS: ListKind[] = ['inbox', 'today', 'upcoming', 'anytime', 'someday', 'waiting', 'logbook'];

export type Route = View | { kind: 'home' };

export function parseHash(hash: string): Route {
  const [, a, b] = hash.replace(/^#/, '').split('/');
  if (a && (LISTS as string[]).includes(a)) return { kind: a as ListKind };
  if (a === 'project' && b) return { kind: 'project', id: b };
  if (a === 'area' && (b === 'work' || b === 'personal' || b === 'shared')) return { kind: 'area', area: b as Visibility };
  return { kind: 'home' };
}

export function routeToHash(route: Route): string {
  if (route.kind === 'project') return `#/project/${route.id}`;
  if (route.kind === 'area') return `#/area/${route.area}`;
  if (route.kind === 'home') return '#/';
  return `#/${route.kind}`;
}

export function useHashRoute() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = useCallback((next: Route) => {
    window.location.hash = routeToHash(next);
  }, []);
  return [route, navigate] as const;
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
