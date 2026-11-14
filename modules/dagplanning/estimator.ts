import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { STEPS, snap } from './logic.js';

/** Schat per titel de duur in minuten; null = niet gelukt (de regel-heuristiek neemt het dan over). */
export type Estimator = (titles: string[]) => Promise<number[] | null>;

export const MAX_BATCH = 25;
const DEFAULT_MODEL = 'claude-opus-5-5';

const Output = z.object({
  estimates: z.array(z.object({ n: z.number().int(), minutes: z.number().int() }))
});

const SYSTEM = [
  'You estimate how long tasks take for one person, the way a calm, realistic planner would.',
  'Estimate the hands-on time to finish the task in one sitting, including the small overhead of getting started',
  '(finding the file, opening the tool, writing the message). Do not include waiting time for others.',
  'Tasks are often in Dutch. Titles may be terse notes; when a title is vague, assume the most common meaning.',
  'Meetings or sessions: use their usual length. Building, implementing or delivering something: at least 60 minutes.',
  `Answer with one estimate per task, using only these minute values: ${STEPS.join(', ')}.`
].join(' ');

/**
 * AI-schatter via de Anthropic API. Alleen de titel (eerste regel) gaat mee, nooit notities of checklist.
 * Zonder ANTHROPIC_API_KEY bestaat hij niet en gebruikt de module alleen de regel-heuristiek.
 */
export function createEstimator(env: Record<string, string | undefined>, client?: Anthropic): Estimator | null {
  if (!client && !env.ANTHROPIC_API_KEY) return null;
  const anthropic = client ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000 });
  const model = env.DAGPLANNING_MODEL?.trim() || DEFAULT_MODEL;

  return async (titles) => {
    if (titles.length === 0) return [];
    const list = titles.slice(0, MAX_BATCH).map((t, i) => `${i + 1}. ${t}`).join('\n');
    try {
      const res = await anthropic.messages.parse({
        model,
        max_tokens: 4000,
        output_config: { effort: 'low', format: zodOutputFormat(Output) },
        system: SYSTEM,
        messages: [{ role: 'user', content: `Tasks:\n${list}` }]
      });
      if (res.stop_reason === 'refusal' || !res.parsed_output) return null;
      const byN = new Map(res.parsed_output.estimates.map((e) => [e.n, e.minutes]));
      return titles.slice(0, MAX_BATCH).map((_, i) => {
        const v = byN.get(i + 1);
        return typeof v === 'number' && v > 0 ? snap(v) : 0;
      });
    } catch (err) {
      // Typed SDK-fouten: alleen status en type loggen, nooit de titels.
      if (err instanceof Anthropic.APIError) console.error(`[dagplanning] schatten mislukt: ${err.status} ${err.name}`);
      else console.error('[dagplanning] schatten mislukt:', err instanceof Error ? err.message : err);
      return null;
    }
  };
}
