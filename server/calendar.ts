import { addDays } from '../shared/dates.js';
import { occurrencesBetween, parseICS, type CalEvent, type Occurrence } from '../shared/ical.js';

/**
 * Eén gedeelde agendabron voor alle modules (Briefing, Dagplanning, …): één keer ophalen, één cache.
 * Zo vraagt Taskgram een feed maar eens per kwartier op, hoeveel modules hem ook lezen (iCloud throttlet
 * wie te vaak komt). Alleen privé-agenda's; de URL's zijn geheim en komen nooit in de browser of in logs.
 *
 * Configuratie: CALENDAR_FEEDS, of (voor bestaande installaties) BRIEFING_CALENDAR_FEEDS:
 * JSON-lijst [{"naam":"Gezin","url":"webcal://…"}]. `webcal://` wordt `https://`; `http://` alleen naar localhost.
 */

export type Feed = { name: string; url: string };
export type CalendarWindow = { fromDay: string; toDay: string };
export type CalendarResult = { occurrences: Occurrence[]; failed: number; total: number };

export const CALENDAR_TTL_MS = 15 * 60_000;
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 8 * 1024 * 1024;
const RETRY_AFTER_MS = 5 * 60_000;
const STALE_MAX_MS = 24 * 3600_000;

/** null = niet ingesteld (agenda uit); [] = ingesteld maar onbruikbaar. */
export function parseFeeds(raw: string | undefined): Feed[] | null {
  if (!raw?.trim()) return null;
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((e) => {
      const r = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
      let url = typeof r.url === 'string' ? r.url.trim() : '';
      if (url.startsWith('webcal://')) url = `https://${url.slice('webcal://'.length)}`;
      const name = typeof r.naam === 'string' && r.naam.trim() ? r.naam.trim() : typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'Agenda';
      // Alleen https; http alleen naar de eigen machine (lokale preview met nep-agenda).
      return /^https:\/\//.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url) ? { name: name.slice(0, 40), url } : null;
    })
    .filter((f): f is Feed => f !== null);
}

export type CalendarSource = ReturnType<typeof createCalendarSource>;

export function createCalendarSource(opts: { feeds: Feed[]; timeZone: string; ttlMs?: number }) {
  const cache = new Map<string, { at: number; events: CalEvent[] }>();
  const retryNotBefore = new Map<string, number>();
  const inflight = new Map<string, Promise<CalEvent[]>>();
  const ttl = opts.ttlMs ?? CALENDAR_TTL_MS;

  async function load(url: string, now: number): Promise<CalEvent[]> {
    const cached = cache.get(url);
    if (cached && now - cached.at < ttl) return cached.events;
    const usable = cached && now - cached.at < STALE_MAX_MS ? cached.events : null;
    if (now < (retryNotBefore.get(url) ?? 0)) {
      if (usable) return usable;
      throw new Error('calendar retry pending');
    }
    // Twee modules tegelijk: één verzoek.
    const running = inflight.get(url);
    if (running) return running;
    const p = (async () => {
      try {
        const res = await fetch(url, { headers: { accept: 'text/calendar' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const text = await res.text();
        if (text.length > MAX_BYTES || !text.includes('BEGIN:VCALENDAR')) throw new Error('not a calendar');
        const events = parseICS(text, opts.timeZone);
        cache.set(url, { at: now, events });
        retryNotBefore.delete(url);
        return events;
      } catch (err) {
        retryNotBefore.set(url, now + RETRY_AFTER_MS);
        // Alleen het type: de URL is het geheim.
        console.warn(`[agenda] feed niet opgehaald (${(err as Error)?.name ?? 'Error'})`);
        if (usable) return usable;
        throw err;
      } finally {
        inflight.delete(url);
      }
    })();
    inflight.set(url, p);
    return p;
  }

  return {
    feeds: opts.feeds.length,
    /** Afspraken in [fromDay, toDay) (kalenderdagen, toDay exclusief), herhalingen uitgeklapt. */
    async between(window: CalendarWindow, now = Date.now()): Promise<CalendarResult> {
      const results = await Promise.allSettled(opts.feeds.map((f) => load(f.url, now)));
      // Venster ruim genoeg voor elke tijdzone; de aanroeper legt het daarna op kalenderdag.
      const from = Date.parse(`${window.fromDay}T00:00:00Z`) - 14 * 3600_000;
      const to = Date.parse(`${window.toDay}T00:00:00Z`) + 14 * 3600_000;
      const occurrences = results.flatMap((r, i) =>
        r.status === 'fulfilled' ? occurrencesBetween(r.value, { from, to, fromDay: window.fromDay, toDay: window.toDay }, opts.feeds[i]!.name) : []
      );
      return { occurrences, failed: results.filter((r) => r.status === 'rejected').length, total: opts.feeds.length };
    }
  };
}

/** De agendabron uit de omgeving; null als er geen feeds zijn ingesteld. */
export function calendarFromEnv(env: Record<string, string | undefined>, timeZone: string): CalendarSource | null {
  const feeds = parseFeeds(env.CALENDAR_FEEDS ?? env.BRIEFING_CALENDAR_FEEDS);
  return feeds === null ? null : createCalendarSource({ feeds, timeZone });
}

export const dayWindow = (day: string, days = 1): CalendarWindow => ({ fromDay: day, toDay: addDays(day, days) });
