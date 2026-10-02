import { useSyncExternalStore } from 'react';
import { setDateLocale } from '../../shared/dates.js';
import { nl } from './nl.js';
import { en } from './en.js';

export type Lang = 'nl' | 'en';
export type TranslationKey = keyof typeof nl;

const STORAGE_KEY = 'taskgram-lang';

const translations: Record<Lang, Record<TranslationKey, string>> = {
  nl,
  en
};

function detectLang(): Lang {
  if (typeof window !== 'undefined') {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'nl' || saved === 'en') {
      return saved;
    }
    const nav = window.navigator.language || '';
    if (nav.toLowerCase().startsWith('nl')) {
      return 'nl';
    }
  }
  return 'en';
}

let currentLang: Lang = detectLang();
const subscribers = new Set<() => void>();

function applyLangSideEffects(lang: Lang) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
  }
  setDateLocale(lang === 'nl' ? 'nl-NL' : 'en-GB');
}

// Initial side effects
applyLangSideEffects(currentLang);

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  if (lang !== 'nl' && lang !== 'en') return;
  currentLang = lang;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {}
  }
  applyLangSideEffects(lang);
  for (const sub of subscribers) {
    try {
      sub();
    } catch (e) {
      console.error('[i18n] subscriber error:', e);
    }
  }
}

export function subscribe(callback: () => void): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, () => 'en');
}

export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  const dict = translations[currentLang] ?? nl;
  let text: string = dict[key] ?? nl[key] ?? key;
  if (vars) {
    text = text.replace(/\{(\w+)\}/g, (match, vName) => {
      return vName in vars ? String(vars[vName]) : match;
    });
  }
  return text;
}

export type PluralBaseKey = 'sync.conflicts' | 'sync.pending';

export function tn(
  baseKey: PluralBaseKey,
  count: number,
  vars?: Record<string, string | number>
): string {
  const suffix = count === 1 ? 'one' : 'other';
  const fullKey = `${baseKey}.${suffix}` as TranslationKey;
  return t(fullKey, { count, ...vars });
}

export function translateApiError(err: unknown): string {
  if (!err) return t('error.internal');
  if (typeof err === 'string') {
    if (err === 'Volgende herhaling kon niet worden aangemaakt' || err === 'Next recurrence could not be created') {
      return t('error.recurrenceWarning');
    }
    return err;
  }
  if (typeof err === 'object' && err !== null) {
    const errorObj = err as { code?: string; message?: string; status?: number };
    const code = errorObj.code;
    switch (code) {
      case 'VALIDATION':
        if (errorObj.message === 'Cannot link task to itself' || errorObj.message === 'Kan taak niet aan zichzelf koppelen') {
          return t('error.cannotLinkSelf');
        }
        return t('error.validation');
      case 'INTERNAL':
        return t('error.internal');
      case 'NOT_FOUND':
        return t('error.notFound');
      case 'UPSTREAM_UNAVAILABLE':
        return t('error.upstreamUnavailable');
      case 'CONFLICT':
        return t('error.conflict');
      case 'RATE_LIMITED':
        return t('error.rateLimited');
      case 'INVALID_CREDENTIALS':
        return t('error.invalidCredentials');
      case 'UNAUTHORIZED':
        return t('error.unauthorized');
      case 'FORBIDDEN':
        return t('error.forbidden');
      case 'AUTH':
        return t('error.sessionExpired');
    }
    if (errorObj.message) {
      if (errorObj.message === 'Volgende herhaling kon niet worden aangemaakt' || errorObj.message === 'Next recurrence could not be created') {
        return t('error.recurrenceWarning');
      }
      return errorObj.message;
    }
  }
  return t('error.internal');
}
