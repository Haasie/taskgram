import { describe, expect, it } from 'vitest';
import { expandStarts, occurrencesBetween, parseICS, resolveZone, unescapeText, zonedToUtc } from './ical';

const TZ = 'Europe/Amsterdam';
const cal = (...events: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\r\n');
const ev = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
const day = (d: string) => ({ from: Date.parse(`${d}T00:00:00+01:00`), to: Date.parse(`${d}T24:00:00+01:00`), fromDay: d, toDay: nextDay(d) });
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const iso = (ms: number) => new Date(ms).toISOString();

describe('ical: basis', () => {
  it('ontvouwt regels, ontsnapt tekst en negeert VALARM-velden', () => {
    const events = parseICS(
      cal(
        ev(
          'UID:a',
          'DTSTART:20261114T090000Z',
          'DTEND:20261114T100000Z',
          'SUMMARY:Lange\r\n  titel\\, met komma',
          'BEGIN:VALARM',
          'SUMMARY:Herinnering',
          'TRIGGER:-PT15M',
          'END:VALARM'
        )
      ),
      TZ
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe('Lange titel, met komma');
    expect(iso(events[0]!.start)).toBe('2026-11-14T09:00:00.000Z');
    expect(unescapeText('a\\nb\\;c')).toBe('a b;c');
  });

  it('rekent TZID om naar UTC, ook in de zomertijd, en kent Windows-zonenamen', () => {
    const [winter, zomer, windows] = parseICS(
      cal(
        ev('UID:w', 'DTSTART;TZID=Europe/Amsterdam:20261114T090000', 'SUMMARY:w'),
        ev('UID:z', 'DTSTART;TZID=Europe/Amsterdam:20260714T090000', 'SUMMARY:z'),
        ev('UID:x', 'DTSTART;TZID="W. Europe Standard Time":20261114T090000', 'SUMMARY:x')
      ),
      'UTC'
    );
    expect(iso(winter!.start)).toBe('2026-11-14T08:00:00.000Z');
    expect(iso(zomer!.start)).toBe('2026-07-14T07:00:00.000Z');
    expect(iso(windows!.start)).toBe('2026-11-14T08:00:00.000Z');
    expect(resolveZone('Onzin/Zone', TZ)).toBe(TZ);
    expect(iso(zonedToUtc(Date.UTC(2026, 2, 29, 3, 0), TZ))).toBe('2026-03-29T01:00:00.000Z');
  });

  it('zwevende tijd valt in de standaardzone; hele dag zonder einde duurt één dag; DURATION werkt', () => {
    const [zwevend, heledag, duur] = parseICS(
      cal(
        ev('UID:f', 'DTSTART:20261114T090000', 'SUMMARY:f'),
        ev('UID:h', 'DTSTART;VALUE=DATE:20261114', 'SUMMARY:h'),
        ev('UID:d', 'DTSTART:20261114T090000Z', 'DURATION:PT1H30M', 'SUMMARY:d')
      ),
      TZ
    );
    expect(iso(zwevend!.start)).toBe('2026-11-14T08:00:00.000Z');
    expect(heledag!.allDay).toBe(true);
    expect(heledag!.end - heledag!.start).toBe(86_400_000);
    expect(duur!.end - duur!.start).toBe(90 * 60_000);
  });
});

describe('ical: herhalingen', () => {
  const one = (...lines: string[]) => parseICS(cal(ev('UID:r', 'SUMMARY:r', ...lines)), TZ);

  it('wekelijks op meerdere dagen, met COUNT', () => {
    const [e] = one('DTSTART;TZID=Europe/Amsterdam:20261102T190000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4');
    expect(expandStarts(e!, Date.parse('2027-01-01')).map(iso)).toEqual([
      '2026-11-02T18:00:00.000Z',
      '2026-11-04T18:00:00.000Z',
      '2026-11-09T18:00:00.000Z',
      '2026-11-11T18:00:00.000Z'
    ]);
  });

  it('houdt de wandkloktijd vast over de zomertijdgrens', () => {
    const [e] = one('DTSTART;TZID=Europe/Amsterdam:20261019T090000', 'RRULE:FREQ=WEEKLY');
    const starts = expandStarts(e!, Date.parse('2026-11-03')).map(iso);
    expect(starts[0]).toBe('2026-10-19T07:00:00.000Z');
    expect(starts[2]).toBe('2026-11-02T08:00:00.000Z');
  });

  it('maandelijks op de laatste vrijdag en op dag 31 (slaat korte maanden over)', () => {
    const [last] = one('DTSTART:20260925T100000Z', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3');
    expect(expandStarts(last!, Date.parse('2027-01-01')).map(iso)).toEqual(['2026-09-25T10:00:00.000Z', '2026-10-30T10:00:00.000Z', '2026-11-27T10:00:00.000Z']);
    const [d31] = one('DTSTART;VALUE=DATE:20260831', 'RRULE:FREQ=MONTHLY;COUNT=3');
    expect(expandStarts(d31!, Date.parse('2027-06-01')).map((ms) => iso(ms).slice(0, 10))).toEqual(['2026-08-31', '2026-10-31', '2026-12-31']);
  });

  it('jaarlijks (verjaardag) en UNTIL als datum telt de hele dag', () => {
    const [bday] = one('DTSTART;VALUE=DATE:19800314', 'RRULE:FREQ=YEARLY');
    const hits = occurrencesBetween([bday!], { from: 0, to: 0, fromDay: '2027-03-14', toDay: '2027-03-15' }, 'Privé');
    expect(hits).toHaveLength(1);
    const [until] = one('DTSTART:20261110T090000Z', 'RRULE:FREQ=DAILY;UNTIL=20261112');
    expect(expandStarts(until!, Date.parse('2027-01-01'))).toHaveLength(3);
  });

  it('EXDATE haalt een keer weg; RECURRENCE-ID verplaatst een keer', () => {
    const events = parseICS(
      cal(
        ev('UID:s', 'SUMMARY:Overleg', 'DTSTART;TZID=Europe/Amsterdam:20261109T100000', 'DTEND;TZID=Europe/Amsterdam:20261109T110000', 'RRULE:FREQ=DAILY', 'EXDATE;TZID=Europe/Amsterdam:20261113T100000'),
        ev('UID:s', 'SUMMARY:Overleg (later)', 'RECURRENCE-ID;TZID=Europe/Amsterdam:20261114T100000', 'DTSTART;TZID=Europe/Amsterdam:20261114T150000', 'DTEND;TZID=Europe/Amsterdam:20261114T160000')
      ),
      TZ
    );
    expect(occurrencesBetween(events, day('2026-11-13'), 'Privé')).toHaveLength(0);
    const sat = occurrencesBetween(events, day('2026-11-14'), 'Privé');
    expect(sat.map((o) => [o.title, iso(o.start)])).toEqual([['Overleg (later)', '2026-11-14T14:00:00.000Z']]);
    expect(occurrencesBetween(events, day('2026-11-15'), 'Privé')).toHaveLength(1);
  });

  it('afgezegde afspraken en niet-ondersteunde regels verzinnen niets', () => {
    const events = parseICS(
      cal(
        ev('UID:c', 'SUMMARY:c', 'DTSTART:20261114T090000Z', 'STATUS:CANCELLED'),
        ev('UID:p', 'SUMMARY:p', 'DTSTART:20261101T090000Z', 'RRULE:FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=-1')
      ),
      TZ
    );
    expect(occurrencesBetween(events, day('2026-11-14'), 'x')).toHaveLength(0);
    expect(expandStarts(events[1]!, Date.parse('2027-01-01'))).toHaveLength(1);
  });

  it('een dagelijkse reeks van jaren terug blijft snel en eindig', () => {
    const [e] = one('DTSTART:20000101T080000Z', 'RRULE:FREQ=DAILY');
    const t0 = Date.now();
    expect(occurrencesBetween([e!], day('2026-11-14'), 'x')).toHaveLength(1);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
