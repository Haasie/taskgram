import { useCallback, useEffect, useState } from 'react';
import type { Visibility } from '../../shared/types';
import type { ListKind, View } from './lists';
import { moduleById, moduleByRoute } from '../../modules/registry.js';

const LISTS: ListKind[] = ['inbox', 'today', 'upcoming', 'anytime', 'someday', 'waiting', 'logbook'];

export type Route = View | { kind: 'home' } | { kind: 'module'; id: string };

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const qi = raw.indexOf('?');
  const path = qi >= 0 ? raw.slice(0, qi) : raw;
  const query = qi >= 0 ? raw.slice(qi + 1) : '';
  const [, a, b] = path.split('/');
  if (a === 'favorites') return { kind: 'favorites' };
  if (a === 'filter') return { kind: 'filter', query, ...(b ? { savedId: b } : {}) };
  if (a && (LISTS as string[]).includes(a)) return { kind: a as ListKind };
  if (a === 'project' && b) return { kind: 'project', id: b };
  if (a === 'area' && (b === 'work' || b === 'personal' || b === 'shared')) return { kind: 'area', area: b as Visibility };
  if (a === 'radar' && (b === 'work' || b === 'personal')) return { kind: 'radar', area: b as Visibility };
  const mod = a ? moduleByRoute(a) : undefined;
  if (mod) return { kind: 'module', id: mod.id };
  return { kind: 'home' };
}

export function routeToHash(route: Route): string {
  if (route.kind === 'project') return `#/project/${route.id}`;
  if (route.kind === 'area') return `#/area/${route.area}`;
  if (route.kind === 'radar') return `#/radar/${route.area}`;
  if (route.kind === 'home') return '#/';
  if (route.kind === 'module') return `#/${moduleById(route.id)?.route ?? ''}`;
  if (route.kind === 'filter') return `#/filter${route.savedId ? `/${route.savedId}` : ''}${route.query ? `?${route.query}` : ''}`;
  return `#/${route.kind}`;
}

export function useHashRoute() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = useCallback((next: Route, opts?: { replace?: boolean }) => {
    if (opts?.replace) {
      window.history.replaceState(window.history.state, '', routeToHash(next));
      setRoute(parseHash(window.location.hash));
    } else window.location.hash = routeToHash(next);
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
