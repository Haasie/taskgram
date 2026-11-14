/**
 * Kleine iCal-lezer voor de gedeelde agendabron (server/calendar.ts): alleen wat nodig is om "wat staat er
 * vandaag/morgen" te tonen en hoeveel tijd afspraken innemen. Geen afhankelijkheid, dus zelf: regels ontvouwen, VEVENT's lezen,
 * tijdzones via Intl, en herhalingen uitklappen (RRULE met FREQ/INTERVAL/COUNT/UNTIL/BYDAY/BYMONTHDAY/BYMONTH,
 * EXDATE en losse wijzigingen via RECURRENCE-ID). BYSETPOS en uur-/minuutherhalingen worden niet ondersteund;
 * zo'n reeks toont alleen de eerste keer in plaats van iets te verzinnen.
 */

export type CalEvent = {
  uid: string;
  title: string;
  allDay: boolean;
  /** Tijd: UTC-ms. Hele dag: middernacht UTC van de kalenderdag (alleen als dagnummer gebruikt). */
  start: number;
  end: number;
  /** Tijdzone van de wandkloktijd, voor herhalingen (zomertijd!). null = UTC of hele dag. */
  tz: string | null;
  rrule: RRule | null;
  exdates: Set<string>;
  recurrenceId: string | null;
  cancelled: boolean;
};

export type RRule = {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count: number | null;
  until: number | null;
  byDay: { n: number; wd: number }[];
  byMonthDay: number[];
  byMonth: number[];
};

export type Occurrence = { uid: string; title: string; allDay: boolean; start: number; end: number; calendar: string };

const DAY = 86_400_000;
const MAX_STEPS = 50_000;
const WEEKDAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** Windows-namen die Outlook/Exchange in TZID zet, naar IANA. Onbekend → standaardzone. */
const WINDOWS_TZ: Record<string, string> = {
  'W. Europe Standard Time': 'Europe/Amsterdam',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'GMT Standard Time': 'Europe/London',
  UTC: 'UTC'
};

type Prop = { name: string; params: Record<string, string>; value: string };

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseLine(line: string): Prop | null {
  // Naam en parameters lopen tot de eerste ':' buiten aanhalingstekens.
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const [rawName, ...rawParams] = line.slice(0, colon).split(';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: (rawName ?? '').toUpperCase(), params, value: line.slice(colon + 1) };
}

export function unescapeText(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? ' ' : c)).replace(/\s+/g, ' ').trim();
}

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveZone(tzid: string | undefined, fallback: string): string {
  if (!tzid) return fallback;
  const clean = tzid.replace(/^\/+/, '');
  const mapped = WINDOWS_TZ[clean] ?? clean;
  return validZone(mapped) ? mapped : fallback;
}

const offsetCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = offsetCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    offsetCache.set(tz, f);
  }
  return f;
}

/** Wandklok in `tz` op moment `ms`, als UTC-ms met dezelfde cijfers. */
function wallAsUtc(ms: number, tz: string): number {
  const parts = Object.fromEntries(formatter(tz).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
}

/** Wandkloktijd (als UTC-cijfers) in `tz` naar het echte UTC-moment. */
export function zonedToUtc(wall: number, tz: string): number {
  if (tz === 'UTC') return wall;
  let guess = wall - (wallAsUtc(wall, tz) - wall);
  // Tweede ronde vangt de zomertijdovergang op.
  guess = wall - (wallAsUtc(guess, tz) - guess);
  return guess;
}

type DateVal = { ms: number; allDay: boolean; tz: string | null };

function parseDate(prop: Prop, fallbackTz: string): DateVal | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(prop.value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const wall = Date.UTC(+y!, +mo! - 1, +d!, h ? +h : 0, mi ? +mi : 0, s ? +s : 0);
  if (!h || prop.params.VALUE === 'DATE') return { ms: Date.UTC(+y!, +mo! - 1, +d!), allDay: true, tz: null };
  if (z) return { ms: wall, allDay: false, tz: null };
  const tz = resolveZone(prop.params.TZID, fallbackTz);
  return { ms: zonedToUtc(wall, tz), allDay: false, tz };
}

function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((+(w ?? 0) * 7 + +(d ?? 0)) * 24 * 3600 + +(h ?? 0) * 3600 + +(mi ?? 0) * 60 + +(s ?? 0)) * 1000;
  return sign === '-' ? -ms : ms;
}

function parseRRule(v: string, fallbackTz: string): RRule | null {
  const parts = Object.fromEntries(
    v.split(';').map((kv) => {
      const [k, val] = kv.split('=');
      return [(k ?? '').toUpperCase(), val ?? ''];
    })
  );
  const freq = parts.FREQ;
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;
  if (parts.BYSETPOS || parts.BYHOUR || parts.BYMINUTE) return null;
  const ints = (s: string | undefined) => (s ? s.split(',').map(Number).filter((n) => Number.isInteger(n) && n !== 0) : []);
  const byDay = (parts.BYDAY ? parts.BYDAY.split(',') : [])
    .map((t) => /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(t.trim().toUpperCase()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ n: m[1] ? Number(m[1]) : 0, wd: WEEKDAYS[m[2]!]! }));
  const until = parts.UNTIL ? parseDate({ name: 'UNTIL', params: {}, value: parts.UNTIL }, fallbackTz) : null;
  const interval = Number(parts.INTERVAL ?? 1);
  const count = parts.COUNT ? Number(parts.COUNT) : null;
  return {
    freq,
    interval: Number.isInteger(interval) && interval > 0 ? interval : 1,
    count: count !== null && Number.isInteger(count) && count > 0 ? count : null,
    // Een UNTIL als datum telt de hele dag mee.
    until: until ? (until.allDay ? until.ms + DAY - 1 : until.ms) : null,
    byDay,
    byMonthDay: ints(parts.BYMONTHDAY),
    byMonth: ints(parts.BYMONTH).filter((n) => n >= 1 && n <= 12)
  };
}

/** Sleutel voor EXDATE/RECURRENCE-ID: het UTC-moment, of de kalenderdag bij hele-dag-afspraken. */
const occKey = (ms: number, allDay: boolean) => (allDay ? `D${new Date(ms).toISOString().slice(0, 10)}` : `T${ms}`);

export function parseICS(text: string, fallbackTz: string): CalEvent[] {
  const out: CalEvent[] = [];
  let cur: Prop[] | null = null;
  let depth = 0;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') {
      cur = [];
      depth = 0;
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('BEGIN:')) depth++;
    else if (line.startsWith('END:') && line !== 'END:VEVENT') depth--;
    else if (line === 'END:VEVENT') {
      const ev = toEvent(cur, fallbackTz);
      if (ev) out.push(ev);
      cur = null;
    } else if (depth === 0) {
      // Eigenschappen van een VALARM binnen het event (depth > 0) horen niet bij het event zelf.
      const p = parseLine(line);
      if (p) cur.push(p);
    }
  }
  return out;
}

function toEvent(props: Prop[], fallbackTz: string): CalEvent | null {
  const get = (n: string) => props.find((p) => p.name === n);
  const startProp = get('DTSTART');
  if (!startProp) return null;
  const start = parseDate(startProp, fallbackTz);
  if (!start) return null;
  const endProp = get('DTEND');
  const end = endProp ? parseDate(endProp, fallbackTz) : null;
  const dur = get('DURATION') ? parseDuration(get('DURATION')!.value) : null;
  const endMs = end && end.ms > start.ms ? end.ms : dur !== null && dur > 0 ? start.ms + dur : start.allDay ? start.ms + DAY : start.ms;

  const exdates = new Set<string>();
  for (const p of props.filter((x) => x.name === 'EXDATE')) {
    for (const v of p.value.split(',')) {
      const d = parseDate({ ...p, value: v }, fallbackTz);
      if (d) exdates.add(occKey(d.ms, start.allDay));
    }
  }
  const rid = get('RECURRENCE-ID');
  const ridDate = rid ? parseDate(rid, fallbackTz) : null;
  const rruleProp = get('RRULE');

  return {
    uid: get('UID')?.value.trim() || `${startProp.value}-${get('SUMMARY')?.value ?? ''}`,
    title: unescapeText(get('SUMMARY')?.value ?? '') || '(zonder titel)',
    allDay: start.allDay,
    start: start.ms,
    end: endMs,
    tz: start.tz,
    rrule: rruleProp ? parseRRule(rruleProp.value, fallbackTz) : null,
    exdates,
    recurrenceId: ridDate ? occKey(ridDate.ms, start.allDay) : null,
    cancelled: get('STATUS')?.value.trim().toUpperCase() === 'CANCELLED'
  };
}

/** Dagnummer (dagen sinds 1970) en terug, op UTC-cijfers. */
const dayNum = (wallMs: number) => Math.floor(wallMs / DAY);
const ymd = (dn: number) => {
  const d = new Date(dn * DAY);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay() };
};
const fromYmd = (y: number, m: number, d: number) => dayNum(Date.UTC(y, m, d));
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Kandidaatdagen in één maand voor BYDAY (met of zonder rangnummer) of BYMONTHDAY. */
function monthDays(y: number, m: number, rule: RRule, startDay: number): number[] {
  const dim = daysInMonth(y, m);
  const days = new Set<number>();
  if (rule.byDay.length) {
    for (const { n, wd } of rule.byDay) {
      const matches: number[] = [];
      for (let d = 1; d <= dim; d++) if (ymd(fromYmd(y, m, d)).wd === wd) matches.push(d);
      if (n === 0) matches.forEach((d) => days.add(d));
      else {
        const pick = n > 0 ? matches[n - 1] : matches[matches.length + n];
        if (pick !== undefined) days.add(pick);
      }
    }
    if (rule.byMonthDay.length) {
      const allowed = new Set(rule.byMonthDay.map((md) => (md > 0 ? md : dim + md + 1)));
      for (const d of [...days]) if (!allowed.has(d)) days.delete(d);
    }
  } else if (rule.byMonthDay.length) {
    for (const md of rule.byMonthDay) {
      const d = md > 0 ? md : dim + md + 1;
      if (d >= 1 && d <= dim) days.add(d);
    }
  } else if (startDay <= dim) days.add(startDay);
  return [...days].sort((a, b) => a - b).map((d) => fromYmd(y, m, d));
}

/**
 * Begintijden (UTC-ms) van een herhaalde afspraak, tot `until` (exclusief). Loopt vanaf DTSTART,
 * omdat COUNT vanaf het begin telt; begrensd op MAX_STEPS zodat een rare regel de server niet vasthoudt.
 */
export function expandStarts(ev: CalEvent, until: number): number[] {
  const rule = ev.rrule;
  if (!rule) return [ev.start];
  const tz = ev.tz;
  const wallStart = ev.allDay || !tz ? ev.start : wallAsUtc(ev.start, tz);
  const timeOfDay = wallStart - dayNum(wallStart) * DAY;
  const firstDay = dayNum(wallStart);
  const f = ymd(firstDay);
  const toUtc = (dn: number) => {
    const wall = dn * DAY + timeOfDay;
    return ev.allDay || !tz ? wall : zonedToUtc(wall, tz);
  };

  const out: number[] = [];
  let emitted = 0;
  const limit = Math.min(until, rule.until ?? Infinity);
  for (let step = 0; step < MAX_STEPS; step++) {
    let candidates: number[];
    if (rule.freq === 'DAILY') candidates = [firstDay + step * rule.interval];
    else if (rule.freq === 'WEEKLY') {
      // Week begint op maandag (WKST=MO, de standaard).
      const weekStart = firstDay - ((f.wd + 6) % 7) + step * 7 * rule.interval;
      const wds = rule.byDay.length ? rule.byDay.map((b) => b.wd) : [f.wd];
      candidates = [...new Set(wds)].map((wd) => weekStart + ((wd + 6) % 7)).sort((a, b) => a - b);
    } else if (rule.freq === 'MONTHLY') {
      const total = f.m + step * rule.interval;
      const y = f.y + Math.floor(total / 12);
      const m = total % 12;
      if (rule.byMonth.length && !rule.byMonth.includes(m + 1)) candidates = [];
      else candidates = monthDays(y, m, rule, f.d);
    } else {
      const y = f.y + step * rule.interval;
      const months = rule.byMonth.length ? rule.byMonth.map((x) => x - 1) : [f.m];
      candidates = months
        .sort((a, b) => a - b)
        .flatMap((m) => (rule.byDay.length || rule.byMonthDay.length ? monthDays(y, m, rule, f.d) : f.d <= daysInMonth(y, m) ? [fromYmd(y, m, f.d)] : []));
    }
    for (const dn of candidates) {
      if (dn < firstDay) continue;
      const startMs = toUtc(dn);
      if (startMs > limit) return out;
      out.push(startMs);
      emitted++;
      if (rule.count !== null && emitted >= rule.count) return out;
    }
    if (candidates.length && toUtc(candidates[candidates.length - 1]!) > limit) return out;
  }
  return out;
}

/**
 * Afspraken die het venster [from, to) raken, met herhalingen uitgeklapt, uitzonderingen eruit en
 * gewijzigde keren (RECURRENCE-ID) op hun nieuwe plek. Hele-dag-afspraken gaan op kalenderdag:
 * `fromDay`/`toDay` (YYYY-MM-DD, `toDay` exclusief).
 */
export function occurrencesBetween(
  events: CalEvent[],
  window: { from: number; to: number; fromDay: string; toDay: string },
  calendar: string
): Occurrence[] {
  const overrides = new Map<string, Set<string>>();
  for (const ev of events) {
    if (ev.recurrenceId) {
      const set = overrides.get(ev.uid) ?? new Set<string>();
      set.add(ev.recurrenceId);
      overrides.set(ev.uid, set);
    }
  }
  const fromAllDay = Date.parse(`${window.fromDay}T00:00:00Z`);
  const toAllDay = Date.parse(`${window.toDay}T00:00:00Z`);
  const out: Occurrence[] = [];
  for (const ev of events) {
    if (ev.cancelled) continue;
    const length = ev.end - ev.start;
    const [lo, hi] = ev.allDay ? [fromAllDay, toAllDay] : [window.from, window.to];
    const starts = ev.recurrenceId ? [ev.start] : expandStarts(ev, hi);
    const moved = ev.recurrenceId ? null : overrides.get(ev.uid);
    for (const s of starts) {
      const key = occKey(s, ev.allDay);
      if (ev.exdates.has(key) || moved?.has(key)) continue;
      if (s < hi && s + Math.max(length, 1) > lo) {
        out.push({ uid: ev.uid, title: ev.title, allDay: ev.allDay, start: s, end: s + length, calendar });
      }
    }
  }
  return out;
}
