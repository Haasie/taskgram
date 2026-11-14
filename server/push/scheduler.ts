import { todayInZone, timeInZone } from '../../shared/dates.js';
import { completionDayInZone, eveningDigest, morningDigest, type DigestLang, type DigestMessage } from '../../shared/digest.js';
import { deadline, startDate } from '../../shared/taskFields.js';
import type { Task } from '../../shared/types.js';
import { toTask } from '../mappers.js';
import type { PostgramClient } from '../postgram.js';
import type { PushSender } from './sender.js';
import type { PushStore } from './store.js';

export type SchedulerDeps = {
  pg: PostgramClient;
  store: PushStore;
  sender: PushSender;
  timeZone: string;
  now?: () => Date;
  /** Modules mogen de ochtend- en avondpush aanvullen (zie ModuleServer.digest). */
  augment?: (kind: 'morning' | 'evening', message: DigestMessage | null, lang: DigestLang) => Promise<DigestMessage | null>;
};

/**
 * Aantal taken dat vandaag (lokale datum) is afgerond. Postgram sorteert op aanmaakdatum, niet op
 * afronddatum: een oude taak die vandaag af is kan overal in de lijst staan. Daarom de hele lijst
 * afgeronde taken, één keer per avond (listTasks pagineert zelf en stopt bij 5000).
 */
async function countDoneToday(pg: PostgramClient, today: string, timeZone: string): Promise<number> {
  const done = await pg.listTasks('done');
  return done.filter((raw) => completionDayInZone(toTask(raw), timeZone) === today).length;
}

export function createScheduler(deps: SchedulerDeps) {
  return {
    async tick(): Promise<void> {
      try {
        const subscriptions = deps.store.getState().subscriptions;
        if (subscriptions.length === 0) {
          return;
        }

        const now = (deps.now ?? (() => new Date()))();
        const today = todayInZone(now, deps.timeZone);
        const time = timeInZone(now, deps.timeZone);

        // 2. Fetch open tasks
        let tasks: Task[];
        try {
          const lists = await Promise.all([
            deps.pg.listTasks('inbox'),
            deps.pg.listTasks('next'),
            deps.pg.listTasks('active'),
            deps.pg.listTasks('waiting'),
            deps.pg.listTasks('scheduled')
          ]);
          tasks = lists.flat().map(toTask);
        } catch (err) {
          console.error('[scheduler] Failed to list tasks:', err);
          return;
        }

        const state = deps.store.getState();
        const goneEndpoints = new Set<string>();
        const lang = state.settings.language ?? 'nl';
        const isEn = lang === 'en';

        const sendAll = async (payload: { title: string; body: string; url: string; tag: string }) => {
          for (const sub of state.subscriptions) {
            if (goneEndpoints.has(sub.endpoint)) continue;
            const res = await deps.sender.send(sub, payload);
            if (res === 'gone') {
              goneEndpoints.add(sub.endpoint);
            }
          }
        };

        // 3. Digest (ochtend)
        if (state.settings.digestEnabled && time >= state.settings.digestTime && state.sent.digest !== today) {
          const base = morningDigest(tasks, today, lang);
          const payload = deps.augment ? await deps.augment('morning', base, lang) : base;
          if (payload) await sendAll(payload);
          deps.store.setDigestSent(today);
        }

        // 3b. Avond: afgerond vandaag + morgen (zondag: komende week)
        if (state.settings.eveningEnabled && time >= state.settings.eveningTime && state.sent.evening !== today) {
          let doneToday: number | null = null;
          try {
            doneToday = await countDoneToday(deps.pg, today, deps.timeZone);
          } catch (err) {
            console.error('[scheduler] Failed to list done tasks:', err);
          }
          // Lukt het tellen niet, dan volgende tick opnieuw proberen in plaats van een verkeerd getal te sturen.
          if (doneToday !== null) {
            const base = eveningDigest(tasks, doneToday, today, lang);
            const payload = deps.augment ? await deps.augment('evening', base, lang) : base;
            if (payload) await sendAll(payload);
            deps.store.setEveningSent(today);
          }
        }

        // 4. Reminders
        for (const task of tasks) {
          const remTime = task.metadata?.reminder_time;
          if (!remTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(remTime)) {
            continue;
          }
          const start = startDate(task);
          const dl = deadline(task);
          const D = start ?? dl;
          if (!D || D !== today || time < remTime) {
            continue;
          }
          const key = `${task.id}@${D}T${remTime}`;
          if (key in state.sent.reminders) {
            continue;
          }

          const fallbackTitle = isEn ? 'Reminder' : 'Herinnering';
          const rawTitle = (task.content ?? '').replace(/\r\n/g, '\n').split('\n')[0]?.replace(/^#+\s*/, '').trim() || fallbackTitle;
          const title = rawTitle.slice(0, 120);
          const isDeadline = !start && Boolean(dl);
          const body = isDeadline ? `Deadline: ${D}` : fallbackTitle;
          const payload = {
            title,
            body,
            url: '/#/today',
            tag: `reminder-${task.id}`
          };

          for (const sub of state.subscriptions) {
            if (goneEndpoints.has(sub.endpoint)) continue;
            const res = await deps.sender.send(sub, payload);
            if (res === 'gone') {
              goneEndpoints.add(sub.endpoint);
            }
          }
          deps.store.recordReminderSent(key, now.toISOString());
        }

        // 5. Cleanup & persist once
        if (goneEndpoints.size > 0) {
          deps.store.removeByEndpoints([...goneEndpoints]);
        }
        deps.store.pruneReminders(7 * 24 * 60 * 60 * 1000, now.getTime());
        deps.store.save();
      } catch (err) {
        console.error('[scheduler] Error in tick:', err);
      }
    }
  };
}
