import { addDays, parseISODate } from '../../shared/dates.js';
import type { WhenChoice } from './when';

/**
 * Vikunja-achtige "Quick Add Magic": haalt labels, project, prioriteit en datums uit de titel.
 *   *tag  *"twee woorden"   +project  +"Mijn project"   !1 … !5
 *   aan het eind: vandaag/today, vanavond/tonight, morgen/tomorrow, ooit/someday, maandag/monday …, 2026-11-03
 *   deadline aan het eind: "due 2026-11-03", "deadline morgen", "uiterlijk vrijdag"
 */
export type QuickAddResult = {
  title: string;
  tags: string[];
  projectId: string | null;
  priority: number | null;
  when: WhenChoice | null;
  due: string | null;
};

type ProjectRef = { id: string; title: string };

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  zondag: 0, maandag: 1, dinsdag: 2, woensdag: 3, donderdag: 4, vrijdag: 5, zaterdag: 6
};

const DAY_WORDS: Record<string, (today: string) => WhenChoice> = {
  today: () => ({ kind: 'today' }),
  vandaag: () => ({ kind: 'today' }),
  tonight: () => ({ kind: 'evening' }),
  vanavond: () => ({ kind: 'evening' }),
  tomorrow: (today) => ({ kind: 'date', date: addDays(today, 1) }),
  morgen: (today) => ({ kind: 'date', date: addDays(today, 1) }),
  someday: () => ({ kind: 'someday' }),
  ooit: () => ({ kind: 'someday' }),
  'next week': (today) => ({ kind: 'date', date: addDays(today, 7) }),
  'volgende week': (today) => ({ kind: 'date', date: addDays(today, 7) })
};

const DEADLINE_WORDS = ['due', 'deadline', 'uiterlijk', 'voor'];

function nextWeekday(today: string, weekday: number): string {
  const current = parseISODate(today).getDay();
  const delta = ((weekday - current + 7) % 7) || 7;
  return addDays(today, delta);
}

/** Datumwoord → ISO-datum (voor deadlines); 'today'/'tonight' tellen als vandaag. */
function dateOf(word: string, today: string): string | null {
  const w = word.toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return w;
  if (w in WEEKDAYS) return nextWeekday(today, WEEKDAYS[w]!);
  const choice = DAY_WORDS[w]?.(today);
  if (!choice) return null;
  if (choice.kind === 'date') return choice.date;
  if (choice.kind === 'today' || choice.kind === 'evening') return today;
  return null;
}

function whenOf(word: string, today: string): WhenChoice | null {
  const w = word.toLowerCase();
  if (w in DAY_WORDS) return DAY_WORDS[w]!(today);
  const date = dateOf(w, today);
  return date ? (date <= today ? { kind: 'today' } : { kind: 'date', date }) : null;
}

const DATE_PATTERN = `\\d{4}-\\d{2}-\\d{2}|next week|volgende week|${[...Object.keys(DAY_WORDS), ...Object.keys(WEEKDAYS)]
  .filter((w) => !w.includes(' '))
  .join('|')}`;

const clean = (s: string) => s.replace(/\s{2,}/g, ' ').trim();

export function findProject(name: string, projects: ProjectRef[]): ProjectRef | null {
  const n = name.toLowerCase();
  return (
    projects.find((p) => p.title.toLowerCase() === n) ??
    projects.find((p) => p.title.toLowerCase().startsWith(n)) ??
    projects.find((p) => p.title.toLowerCase().split(/\s+/).some((word) => word.startsWith(n))) ??
    projects.find((p) => p.title.toLowerCase().replace(/\s+/g, '').startsWith(n.replace(/[-_]/g, ''))) ??
    null
  );
}

export function parseQuickAdd(input: string, opts: { today: string; projects: ProjectRef[] }): QuickAddResult {
  let text = ` ${input} `;
  const tags: string[] = [];
  let projectId: string | null = null;
  let priority: number | null = null;
  let when: WhenChoice | null = null;
  let due: string | null = null;

  // Labels: *tag of *"twee woorden"
  text = text.replace(/(\s)\*(?:"([^"]+)"|([^\s"*]+))(?=\s)/g, (_m, sp: string, quoted?: string, bare?: string) => {
    const tag = (quoted ?? bare ?? '').trim();
    if (tag && !tags.includes(tag)) tags.push(tag);
    return sp;
  });

  // Project: +naam of +"naam met spaties"; onbekende projecten blijven in de titel staan.
  text = text.replace(/(\s)\+(?:"([^"]+)"|([^\s"+]+))(?=\s)/g, (m, sp: string, quoted?: string, bare?: string) => {
    if (projectId) return m;
    const hit = findProject((quoted ?? bare ?? '').trim(), opts.projects);
    if (!hit) return m;
    projectId = hit.id;
    return sp;
  });

  // Prioriteit: !1 … !5
  text = text.replace(/(\s)!([1-5])(?=\s)/g, (m, sp: string, n: string) => {
    if (priority !== null) return m;
    priority = Number(n);
    return sp;
  });

  // Datums alleen aan het eind van de titel, zodat "Nieuwe vandaag taak" gewoon een titel blijft.
  // "… deadline vrijdag morgen": eerst het laatste datumwoord (wanneer), dan de deadline-frase ervoor.
  const deadlineRe = new RegExp(`\\s(?:${DEADLINE_WORDS.join('|')}):?\\s+(${DATE_PATTERN})\\s*$`, 'i');
  const whenRe = new RegExp(`\\s(${DATE_PATTERN})\\s*$`, 'i');
  for (let i = 0; i < 2; i++) {
    const dl: RegExpExecArray | null = due === null ? deadlineRe.exec(text) : null;
    const dlDate: string | null = dl ? dateOf(dl[1]!, opts.today) : null;
    if (dl && dlDate) {
      due = dlDate;
      text = text.slice(0, dl.index) + ' ';
      continue;
    }
    const wm: RegExpExecArray | null = when === null ? whenRe.exec(text) : null;
    const w: WhenChoice | null = wm ? whenOf(wm[1]!, opts.today) : null;
    if (wm && w) {
      when = w;
      text = text.slice(0, wm.index) + ' ';
      continue;
    }
    break;
  }

  return { title: clean(text), tags, projectId, priority, when, due };
}
