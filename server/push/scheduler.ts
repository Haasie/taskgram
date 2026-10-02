import { todayInZone, timeInZone } from '../../shared/dates.js';
import { digestCounts } from '../../shared/digest.js';
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

        // 3. Digest
        if (state.settings.digestEnabled && time >= state.settings.digestTime && state.sent.digest !== today) {
          const counts = digestCounts(tasks, today);
          if (counts.today + counts.overdue > 0) {
            const body = isEn
              ? `${counts.today} ${counts.today === 1 ? 'task' : 'tasks'} today · ${counts.overdue} overdue`
              : `${counts.today} taken vandaag · ${counts.overdue} te laat`;
            const payload = {
              title: isEn ? 'Today' : 'Vandaag',
              body,
              url: '/#/today',
              tag: 'digest'
            };
            for (const sub of state.subscriptions) {
              const res = await deps.sender.send(sub, payload);
              if (res === 'gone') {
                goneEndpoints.add(sub.endpoint);
              }
            }
          }
          deps.store.setDigestSent(today);
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
