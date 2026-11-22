import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from './auth.js';

/**
 * AI-opknipper: stelt kleine, concrete stappen voor bij een taak. Alleen de titel (eerste regel) gaat naar de
 * aanbieder, nooit notities, checklist of context; dezelfde lijn als de schatter van Dagplanning.
 * Zonder MISTRAL_API_KEY bestaat de functie niet en verbergt de app de knop.
 */
export type BreakdownResult = { steps: string[] } | { error: string };
export type Breakdown = (title: string, lang: 'nl' | 'en') => Promise<BreakdownResult>;

const DEFAULT_MODEL = 'mistral-small-latest';
const DEFAULT_BASE = 'https://api.mistral.ai/v1';
export const MAX_STEPS = 8;
const STEP_MAX_LEN = 120;

const Output = z.union([
  z.object({ steps: z.array(z.unknown()) }).transform((o) => o.steps),
  z.array(z.unknown())
]);

function system(lang: 'nl' | 'en') {
  return [
    'You help someone with ADHD start and finish a task by breaking it into small, concrete steps.',
    'Give 3 to 7 steps in order. Each step is one physical or visible action that starts with a verb, at most 10 words.',
    'The first step must take under two minutes and remove the barrier to starting (open the file, get the thing, write one line).',
    'No vague steps such as "plan", "think about" or "prepare"; no waiting for others; no numbering or emoji in the text.',
    'Titles may be terse notes; when a title is vague, assume the most common meaning.',
    lang === 'nl' ? 'Write the steps in Dutch, informal (je/jij).' : 'Write the steps in English.',
    'Reply with JSON only: {"steps":["...", "..."]}.'
  ].join(' ');
}

/** Opschonen: tekst, geen nummering of opsommingstekens, niet leeg, uniek, begrensd. */
export function cleanSteps(raw: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const text = (typeof r === 'string' ? r : typeof r === 'object' && r && 'text' in r ? String((r as { text: unknown }).text) : '')
      .replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, STEP_MAX_LEN);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= MAX_STEPS) break;
  }
  return out;
}

export function createBreakdown(env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch): Breakdown | null {
  const key = env.MISTRAL_API_KEY?.trim();
  if (!key || env.AI_BREAKDOWN?.trim().toLowerCase() === 'off') return null;
  const model = env.BREAKDOWN_MODEL?.trim() || env.DAGPLANNING_MODEL?.trim() || DEFAULT_MODEL;
  const base = (env.MISTRAL_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, '');

  const fail = (why: string): { error: string } => {
    // Alleen een korte reden: nooit de titel, de sleutel of de ruwe body.
    console.error(`[ai] opknippen mislukt: ${why}`);
    return { error: why };
  };

  return async (title, lang) => {
    try {
      const res = await fetchImpl(`${base}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          max_tokens: 600,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system(lang) },
            { role: 'user', content: `Task: ${title}` }
          ]
        }),
        signal: AbortSignal.timeout(30_000)
      });
      if (!res.ok) return fail(`HTTP ${res.status}`);
      const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') return fail('geen tekst in antwoord');
      let json: unknown;
      try {
        json = JSON.parse(content);
      } catch {
        return fail('geen geldige JSON');
      }
      const parsed = Output.safeParse(json);
      if (!parsed.success) return fail('antwoord past niet in schema');
      const steps = cleanSteps(parsed.data);
      return steps.length ? { steps } : fail('geen stappen');
    } catch (err) {
      return fail(err instanceof Error ? err.name : 'onbekend');
    }
  };
}

const breakdownBody = z
  .object({
    title: z.string().trim().min(1).max(300),
    lang: z.enum(['nl', 'en']).optional()
  })
  .strict();

/** Ruim genoeg voor gewoon gebruik, een rem op een vastgelopen lus of een gestolen sessie. */
export const HOURLY_LIMIT = 30;

export function createAiRoutes(opts: { breakdown: Breakdown | null; now?: () => number }) {
  const now = opts.now ?? Date.now;
  const calls: number[] = [];
  const routes = new Hono<AuthEnv>();

  routes.get('/status', (c) => c.json({ breakdown: opts.breakdown !== null }));

  routes.post('/breakdown', async (c) => {
    if (!opts.breakdown) return c.json({ error: { code: 'AI_DISABLED', message: 'AI is not configured' } }, 503);
    const body = breakdownBody.parse(await c.req.json());
    const t = now();
    while (calls.length && calls[0]! <= t - 3_600_000) calls.shift();
    if (calls.length >= HOURLY_LIMIT) return c.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, 429);
    calls.push(t);
    const result = await opts.breakdown(body.title, body.lang ?? 'nl');
    if ('error' in result) return c.json({ error: { code: 'AI_FAILED', message: 'Could not break down this task' } }, 502);
    return c.json({ steps: result.steps });
  });

  return routes;
}
