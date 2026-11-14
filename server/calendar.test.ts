import { afterEach, describe, expect, it, vi } from 'vitest';
import { calendarFromEnv, createCalendarSource, parseFeeds } from './calendar.js';

const ICS = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:a', 'DTSTART:20261116T090000Z', 'DTEND:20261116T100000Z', 'SUMMARY:Tandarts', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

afterEach(() => vi.unstubAllGlobals());

describe('gedeelde agendabron', () => {
  it('leest feeds zoals calendars.json; webcal wordt https; http alleen lokaal', () => {
    expect(parseFeeds(undefined)).toBeNull();
    expect(parseFeeds('geen json')).toEqual([]);
    expect(
      parseFeeds(JSON.stringify([{ naam: 'Gezin', url: 'webcal://p01.icloud.com/x' }, { naam: 'Fout', url: 'http://elders.nl/x' }, { url: 'http://localhost:4010/c.ics' }]))
    ).toEqual([
      { name: 'Gezin', url: 'https://p01.icloud.com/x' },
      { name: 'Agenda', url: 'http://localhost:4010/c.ics' }
    ]);
  });

  it('CALENDAR_FEEDS, met BRIEFING_CALENDAR_FEEDS als terugval; zonder beide geen bron', () => {
    const feeds = JSON.stringify([{ naam: 'Gezin', url: 'https://a.example/c.ics' }]);
    expect(calendarFromEnv({}, 'Europe/Amsterdam')).toBeNull();
    expect(calendarFromEnv({ BRIEFING_CALENDAR_FEEDS: feeds }, 'Europe/Amsterdam')?.feeds).toBe(1);
    expect(calendarFromEnv({ CALENDAR_FEEDS: feeds }, 'Europe/Amsterdam')?.feeds).toBe(1);
  });

  it('haalt een feed één keer per cacheperiode op, ook als twee modules tegelijk vragen', async () => {
    const fetchMock = vi.fn(async () => new Response(ICS, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const src = createCalendarSource({ feeds: [{ name: 'Gezin', url: 'https://a.example/c.ics' }], timeZone: 'Europe/Amsterdam' });
    const now = Date.parse('2026-11-16T07:00:00Z');
    const [a, b] = await Promise.all([
      src.between({ fromDay: '2026-11-16', toDay: '2026-11-17' }, now),
      src.between({ fromDay: '2026-11-16', toDay: '2026-11-17' }, now)
    ]);
    await src.between({ fromDay: '2026-11-16', toDay: '2026-11-17' }, now + 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.occurrences.map((o) => o.title)).toEqual(['Tandarts']);
    expect(b).toEqual(a);
  });

  it('valt een feed weg, dan telt hij als mislukt en gebruikt hij de vorige stand zolang die vers genoeg is', async () => {
    let up = true;
    vi.stubGlobal('fetch', vi.fn(async () => (up ? new Response(ICS) : new Response('weg', { status: 503 }))));
    const src = createCalendarSource({ feeds: [{ name: 'Gezin', url: 'https://a.example/c.ics' }], timeZone: 'Europe/Amsterdam', ttlMs: 1 });
    const now = Date.parse('2026-11-16T07:00:00Z');
    await src.between({ fromDay: '2026-11-16', toDay: '2026-11-17' }, now);
    up = false;
    const stale = await src.between({ fromDay: '2026-11-16', toDay: '2026-11-17' }, now + 10);
    expect(stale).toMatchObject({ failed: 0, total: 1 });
    expect(stale.occurrences).toHaveLength(1);
    const cold = createCalendarSource({ feeds: [{ name: 'Gezin', url: 'https://b.example/c.ics' }], timeZone: 'Europe/Amsterdam' });
    expect(await cold.between({ fromDay: '2026-11-16', toDay: '2026-11-17' }, now)).toMatchObject({ failed: 1, occurrences: [] });
  });
});
