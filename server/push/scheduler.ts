import { todayInZone, timeInZone } from '../../shared/dates.js';
import { completionDayInZone, eveningDigest, morningDigest } from '../../shared/digest.js';
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
};

const DONE_PAGE = 100;
const DONE_MAX_PAGES = 3;

/**
 * Aantal taken dat vandaag (lokale datum) is afgerond. Begrensd op een paar pagina's:
 * de volgorde van Postgram is niet gegarandeerd, dus we stoppen niet op de eerste oude taak.
 */
async function countDoneToday(pg: PostgramClient, today: string, timeZone: string): Promise<number> {
  let count = 0;
  for (let page = 0; page < DONE_MAX_PAGES; page++) {
    const res = await pg.listTasksPage('done', DONE_PAGE, page * DONE_PAGE);
    for (const raw of res.items) {
      if (completionDayInZone(toTask(raw), timeZone) === today) count++;
    }
    if (res.items.length < DONE_PAGE || (page + 1) * DONE_PAGE >= res.total) break;
  }
  return count;
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
          const payload = morningDigest(tasks, today, lang);
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
            const payload = eveningDigest(tasks, doneToday, today, lang);
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
