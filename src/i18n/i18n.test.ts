import { beforeEach, describe, expect, it } from 'vitest';
import { setLang, t, tn, translateApiError } from './index.js';
import { nl } from './nl.js';
import { en } from './en.js';

describe('i18n', () => {
  beforeEach(() => {
    setLang('nl');
  });

  it('nl and en have identical keys', () => {
    const nlKeys = Object.keys(nl).sort();
    const enKeys = Object.keys(en).sort();
    expect(nlKeys).toEqual(enKeys);
  });

  it('translates strings for nl and en', () => {
    setLang('nl');
    expect(t('list.today')).toBe('Vandaag');
    setLang('en');
    expect(t('list.today')).toBe('Today');
  });

  it('interpolates variables', () => {
    setLang('nl');
    expect(t('sidebar.loggedInAs', { user: 'Alice' })).toBe('Ingelogd als Alice');
    setLang('en');
    expect(t('sidebar.loggedInAs', { user: 'Alice' })).toBe('Logged in as Alice');
  });

  it('handles plural forms with tn()', () => {
    setLang('nl');
    expect(tn('sync.conflicts', 1)).toBe('1 conflict');
    expect(tn('sync.conflicts', 3)).toBe('3 conflicten');

    setLang('en');
    expect(tn('sync.conflicts', 1)).toBe('1 conflict');
    expect(tn('sync.conflicts', 3)).toBe('3 conflicts');
  });

  it('translates API error codes', () => {
    setLang('nl');
    expect(translateApiError({ code: 'VALIDATION' })).toBe('Ongeldige invoer');
    expect(translateApiError({ code: 'UPSTREAM_UNAVAILABLE' })).toBe('Postgram is niet bereikbaar');
    expect(translateApiError('Volgende herhaling kon niet worden aangemaakt')).toBe('Volgende herhaling kon niet worden aangemaakt');

    setLang('en');
    expect(translateApiError({ code: 'VALIDATION' })).toBe('Invalid input');
    expect(translateApiError({ code: 'UPSTREAM_UNAVAILABLE' })).toBe('Postgram is unavailable');
    expect(translateApiError('Next recurrence could not be created')).toBe('Next recurrence could not be created');
  });
});
