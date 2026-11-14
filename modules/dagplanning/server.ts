import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../../server/auth.js';
import { toTask } from '../../server/mappers.js';
import type { ModuleContext } from '../../server/modules/routes.js';
import type { RawEntity } from '../../server/postgram.js';
import { addDays, todayInZone } from '../../shared/dates.js';
import { completionDayInZone, type DigestMessage } from '../../shared/digest.js';
import { deadline, isOpen, priority } from '../../shared/taskFields.js';
import type { Task } from '../../shared/types.js';
import { createEstimator, MAX_BATCH, type Estimator } from './estimator.js';
import {
  adjustEstimate,
  bucketOf,
  candidates,
  capacity,
  correctionFactor,
  defaultWorkMode,
  estimateOf,
  isAgentTask,
  loadOf,
  readSettings,
  slipCounts,
  SLIP_SPLIT,
  suggest,
  titleOf,
  type DayPlan,
  type Settings,
  type WorkMode
} from './logic.js';
import { PLAN_TAG, planContent, planFromEntity, planMetadata } from './plan.js';

const OPEN = ['inbox', 'next', 'active', 'waiting', 'scheduled', 'someday'] as const;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();
const workMode = z.enum(['normal', 'busy', 'off']);
const move = z.object({ id: uuid, to: z.enum(['today', 'tomorrow', 'later', 'someday']) }).strict();

const saveBody = z
  .object({
    date,
    planned: z.array(uuid).max(60),
    workMode,
    ackOver: z.boolean().default(false),
    moves: z.array(move).max(60).default([])
  })
  .strict();
const closeBody = z.object({ date, moves: z.array(move).max(60).default([]) }).strict();
const feedbackBody = z.object({ id: uuid, verdict: z.enum(['longer', 'shorter']) }).strict();
const estimateBody = z.object({ date }).strict();

type State = { estimator?: Estimator | null };

const settingsOf = (ctx: ModuleContext): Settings & { aiEstimates: boolean; autoOpen: boolean } => {
  const raw = ctx.settings();
  return { ...readSettings(raw), aiEstimates: raw.aiEstimates !== false, autoOpen: raw.autoOpen !== false };
};

function estimatorOf(ctx: ModuleContext): Estimator | null {
  const state = ctx.state as State;
  if (state.estimator === undefined) state.estimator = createEstimator(ctx.env);
  return state.estimator;
}

async function openTasks(ctx: ModuleContext): Promise<Task[]> {
  const lists = await Promise.all(OPEN.map((s) => ctx.pg.listTasks(s)));
  return lists.flat().map(toTask);
}

async function loadPlans(ctx: ModuleContext): Promise<DayPlan[]> {
  const raw = await ctx.pg.listEntities('document', [PLAN_TAG]);
  return raw.map(planFromEntity).filter((p): p is DayPlan => p !== null);
}

async function savePlan(ctx: ModuleContext, plan: DayPlan): Promise<DayPlan> {
  const body = { content: planContent(plan), metadata: planMetadata(plan) };
  const saved: RawEntity = plan.id
    ? await ctx.pg.updateEntity(plan.id, { ...body, version: plan.version })
    : await ctx.pg.createEntity({ type: 'document', visibility: 'personal', tags: [PLAN_TAG], ...body });
  return planFromEntity(saved) ?? plan;
}

/** Een taak verplaatsen zoals de app dat doet (Vandaag / morgen / Anytime / Someday). */
function movePatch(to: z.infer<typeof move>['to'], t: Task, today: string) {
  if (to === 'today') {
    const status = t.status === 'active' || t.status === 'waiting' ? t.status : 'next';
    return { status, metadata: { start_date: today } };
  }
  if (to === 'tomorrow') return { status: 'scheduled', metadata: { start_date: addDays(today, 1), evening: false } };
  if (to === 'later') return { status: 'next', metadata: { start_date: null, evening: false } };
  return { status: 'someday', metadata: { start_date: null, evening: false } };
}

async function applyMoves(ctx: ModuleContext, tasks: Map<string, Task>, moves: z.infer<typeof move>[], today: string) {
  const failed: string[] = [];
  for (const m of moves) {
    const t = tasks.get(m.id);
    if (!t || !isOpen(t)) continue;
    try {
      await ctx.pg.updateTask(t.id, { version: t.version, ...movePatch(m.to, t, today) });
    } catch {
      failed.push(t.id);
    }
  }
  return failed;
}

/**
 * Open dagplannen van eerdere dagen afsluiten met wat er die dag echt af kwam. Zo levert een
 * overgeslagen avondritueel geen gat in de historie op: de volgende ochtend gebeurt het vanzelf.
 */
async function closeStale(ctx: ModuleContext, plans: DayPlan[], today: string): Promise<DayPlan[]> {
  const stale = plans.filter((p) => !p.closed && p.date < today);
  if (stale.length === 0) return plans;
  const done = (await ctx.pg.listTasks('done')).map(toTask);
  const out = [...plans];
  for (const p of stale) {
    const closed = await savePlan(ctx, closePlan(p, done, ctx.timeZone));
    out[out.indexOf(p)] = closed;
  }
  return out;
}

function closePlan(p: DayPlan, done: Task[], timeZone: string): DayPlan {
  const doneOnDay = new Set(done.filter((t) => completionDayInZone(t, timeZone) === p.date).map((t) => t.id));
  return { ...p, closed: true, done: p.planned.filter((id) => doneOnDay.has(id)) };
}

type View = ReturnType<typeof slim>;
function slim(t: Task, s: Settings, slips: Map<string, number>) {
  const est = estimateOf(t);
  return {
    id: t.id,
    version: t.version,
    title: titleOf(t),
    bucket: bucketOf(t),
    agent: isAgentTask(t, s),
    estimate: est.min,
    source: est.source,
    deadline: deadline(t),
    priority: priority(t),
    status: t.status,
    slips: slips.get(t.id) ?? 0,
    split: (slips.get(t.id) ?? 0) >= SLIP_SPLIT
  };
}

/** Alles voor het ritueel van één dag in één antwoord. */
async function dayView(ctx: ModuleContext, day: string) {
  const s = settingsOf(ctx);
  const [tasks, plansRaw] = await Promise.all([openTasks(ctx), loadPlans(ctx)]);
  const plans = await closeStale(ctx, plansRaw, day);
  const plan = plans.find((p) => p.date === day) ?? null;
  const history = plans.filter((p) => p.date < day);
  const previous = history.sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  const factor = correctionFactor(history, s);
  const slips = slipCounts(history);
  const mode: WorkMode = plan?.workMode ?? defaultWorkMode(day);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const cand = candidates(tasks, day, previous);
  const pool = [...cand.leftovers, ...cand.today, ...cand.extra];
  const plannedIds = plan ? plan.planned : suggest(cand.today, day, mode, factor.factor, s);
  // Geplande taken die inmiddels af zijn, tellen we niet meer als belasting maar wel als 'af'.
  let doneToday: string[] = [];
  if (plan) {
    const done = (await ctx.pg.listTasks('done')).map(toTask);
    doneToday = closePlan(plan, done, ctx.timeZone).done;
    for (const t of done) if (plan.planned.includes(t.id) && !byId.has(t.id)) byId.set(t.id, t);
  }
  const plannedTasks = plannedIds.map((id) => byId.get(id)).filter((t): t is Task => !!t);
  const seen = new Set(pool.map((t) => t.id));
  const extraPlanned = plannedTasks.filter((t) => !seen.has(t.id) && isOpen(t));
  const load = loadOf(plannedTasks.filter(isOpen), day, mode, factor.factor, s);
  const view = (list: Task[]): View[] => list.map((t) => slim(t, s, slips));
  return {
    date: day,
    plan: plan
      ? { planned: plan.planned, workMode: plan.workMode, ackOver: plan.ackOver, closed: plan.closed, done: doneToday }
      : null,
    suggested: plan ? null : plannedIds,
    workMode: mode,
    factor,
    load,
    settings: {
      agentAttentionMinutes: s.agentAttentionMinutes,
      maxParallelAgents: s.maxParallelAgents,
      capacity: { normal: capacity(day, 'normal', s), busy: capacity(day, 'busy', s), off: capacity(day, 'off', s) }
    },
    ai: s.aiEstimates && estimatorOf(ctx) !== null,
    missingEstimates: pool.filter((t) => typeof t.metadata.estimate_min !== 'number').length,
    leftovers: view(cand.leftovers),
    today: view([...cand.today, ...extraPlanned]),
    extra: view(cand.extra),
    planned: view(plannedTasks),
    inbox: cand.inbox
  };
}

export function routes(ctx: ModuleContext) {
  const api = new Hono<AuthEnv>();
  const today = () => todayInZone(new Date(), ctx.timeZone);

  api.get('/day', async (c) => {
    const day = date.safeParse(c.req.query('date')).success ? (c.req.query('date') as string) : today();
    return c.json(await dayView(ctx, day));
  });

  /** Of de app bij de eerste keer openen het ritueel moet tonen. */
  api.get('/startup', async (c) => {
    const s = settingsOf(ctx);
    if (!s.autoOpen) return c.json({ open: false });
    const day = today();
    const plans = await loadPlans(ctx);
    return c.json({ open: !plans.some((p) => p.date === day), date: day });
  });

  /** Ontbrekende schattingen invullen: AI als die aan staat, anders (of bij een fout) de regel. */
  api.post('/estimate', async (c) => {
    const body = estimateBody.parse(await c.req.json());
    const s = settingsOf(ctx);
    const [tasks, plans] = await Promise.all([openTasks(ctx), loadPlans(ctx)]);
    const previous = plans.filter((p) => p.date < body.date).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
    const cand = candidates(tasks, body.date, previous);
    const missing = [...cand.leftovers, ...cand.today, ...cand.extra]
      .filter((t) => typeof t.metadata.estimate_min !== 'number' && !isAgentTask(t, s))
      .slice(0, MAX_BATCH);
    if (missing.length === 0) return c.json({ estimated: 0, source: null });
    const estimator = s.aiEstimates ? estimatorOf(ctx) : null;
    const ai = estimator ? await estimator(missing.map((t) => titleOf(t))) : null;
    let estimated = 0;
    for (const [i, t] of missing.entries()) {
      const fromAi = ai?.[i] ?? 0;
      const min = fromAi > 0 ? fromAi : estimateOf(t).min;
      try {
        await ctx.pg.updateTask(t.id, { version: t.version, metadata: { estimate_min: min, estimate_source: fromAi > 0 ? 'ai' : 'rule' } });
        estimated += 1;
      } catch {
        // Versieconflict: de taak is net elders gewijzigd; volgende keer opnieuw.
      }
    }
    return c.json({ estimated, source: ai ? 'ai' : 'rule' });
  });

  /** Ochtend: het plan vastleggen, gekozen taken op Vandaag zetten en gisteren-gemist verplaatsen. */
  api.put('/day', async (c) => {
    const body = saveBody.parse(await c.req.json());
    const s = settingsOf(ctx);
    const [tasks, plansRaw] = await Promise.all([openTasks(ctx), loadPlans(ctx)]);
    const plans = await closeStale(ctx, plansRaw, body.date);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const existing = plans.find((p) => p.date === body.date);
    // Opnieuw plannen later op de dag: wat al gepland stond en inmiddels af is, blijft in het plan (telt als af).
    const keep = new Set(existing?.planned ?? []);
    const planned = [...new Set(body.planned)].filter((id) => byId.has(id) || keep.has(id));
    const factor = correctionFactor(plans.filter((p) => p.date < body.date), s);
    const plannedTasks = planned.map((id) => byId.get(id)).filter((t): t is Task => !!t);
    const load = loadOf(plannedTasks, body.date, body.workMode, factor.factor, s);
    if (load.over && !body.ackOver) {
      return c.json({ error: { code: 'OVERCOMMITTED', message: 'Plan is fuller than your usual day' }, load }, 409);
    }
    const est = { ...(existing?.est ?? {}), ...Object.fromEntries(load.items.map((i) => [i.id, i.raw])) };
    for (const k of Object.keys(est)) if (!planned.includes(k)) delete est[k];
    const plan = await savePlan(ctx, {
      id: existing?.id,
      version: existing?.version,
      date: body.date,
      planned,
      est,
      agents: load.items.filter((i) => i.agent).map((i) => i.id),
      workMode: body.workMode,
      ackOver: body.ackOver && load.over,
      closed: false,
      done: existing?.done ?? []
    });
    const isPlannedToday = (t: Task) => {
      const start = typeof t.metadata.start_date === 'string' ? t.metadata.start_date : null;
      return t.status !== 'someday' && t.status !== 'inbox' && ((start !== null && start <= body.date) || (deadline(t) ?? '9999') <= body.date);
    };
    const toToday = plannedTasks.filter((t) => !isPlannedToday(t)).map((t) => ({ id: t.id, to: 'today' as const }));
    const moves = [...toToday, ...body.moves.filter((m) => !planned.includes(m.id))];
    const failed = await applyMoves(ctx, byId, moves, body.date);
    return c.json({ plan: { planned: plan.planned, workMode: plan.workMode }, failed });
  });

  /** Avond: afsluiten met wat er af kwam; wat bleef liggen bewust verplaatsen. */
  api.post('/close', async (c) => {
    const body = closeBody.parse(await c.req.json());
    const plans = await loadPlans(ctx);
    const plan = plans.find((p) => p.date === body.date);
    if (!plan) return c.json({ error: { code: 'NOT_FOUND', message: 'No plan for this day' } }, 404);
    const [tasks, done] = await Promise.all([openTasks(ctx), ctx.pg.listTasks('done').then((l) => l.map(toTask))]);
    const closed = await savePlan(ctx, closePlan(plan, done, ctx.timeZone));
    const failed = await applyMoves(ctx, new Map(tasks.map((t) => [t.id, t])), body.moves, body.date);
    return c.json({ done: closed.done.length, planned: closed.planned.length, failed });
  });

  /** "Duurde langer" / "ging sneller": schuift de schatting één stap en markeert hem als van jou. */
  api.post('/feedback', async (c) => {
    const body = feedbackBody.parse(await c.req.json());
    const t = toTask(await ctx.pg.getEntity(body.id));
    const min = adjustEstimate(estimateOf(t).min, body.verdict);
    await ctx.pg.updateTask(t.id, { version: t.version, metadata: { estimate_min: min, estimate_source: 'user' } });
    return c.json({ estimate: min });
  });

  return api;
}

/**
 * Haak voor de bestaande ochtend- en avondpush: geen extra berichten, wel een ingang naar het ritueel.
 * Ochtend zonder plan: "Plan je dag". Avond met plan: hoeveel van het plan af is, en afsluiten.
 */
export async function digest(
  ctx: ModuleContext,
  kind: 'morning' | 'evening',
  message: DigestMessage | null,
  lang: 'nl' | 'en'
): Promise<DigestMessage | null> {
  const day = todayInZone(new Date(), ctx.timeZone);
  const isEn = lang === 'en';
  const plans = await loadPlans(ctx);
  const plan = plans.find((p) => p.date === day);
  const url = '/#/dagplanning';
  if (kind === 'morning') {
    if (plan) return message;
    const line = isEn ? 'Plan your day — a minute' : 'Plan je dag — een minuut';
    return message
      ? { ...message, body: `${line}\n${message.body}`, url }
      : { title: isEn ? 'Today' : 'Vandaag', body: line, url, tag: 'digest' };
  }
  if (!plan || plan.planned.length === 0) return message;
  const done = closePlan(plan, (await ctx.pg.listTasks('done')).map(toTask), ctx.timeZone).done.length;
  const line = isEn
    ? `${done} of ${plan.planned.length} planned done · close your day`
    : `${done} van ${plan.planned.length} gepland af · sluit je dag af`;
  return message
    ? { ...message, body: `${line}\n${message.body}`, url }
    : { title: isEn ? 'Close your day' : 'Dag afsluiten', body: line, url, tag: 'evening' };
}

// Alleen voor tests.
export const _internal = { closePlan, movePatch };
