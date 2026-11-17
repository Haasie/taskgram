import { z } from 'zod';
import { STEPS, snap } from './logic.js';

/** Schat per titel de duur in minuten; null = niet gelukt (de regel-heuristiek neemt het dan over). */
export type Estimator = (titles: string[]) => Promise<number[] | null>;

export const MAX_BATCH = 25;
const DEFAULT_MODEL = 'mistral-small-latest';
const DEFAULT_BASE = 'https://api.mistral.ai/v1';

const Output = z.object({
  estimates: z.array(z.object({ n: z.number().int(), minutes: z.number() }))
});

const SYSTEM = [
  'You estimate how long tasks take for one person, the way a calm, realistic planner would.',
  'Estimate the hands-on time to finish the task in one sitting, including the small overhead of getting started',
  '(finding the file, opening the tool, writing the message). Do not include waiting time for others.',
  'Tasks are often in Dutch. Titles may be terse notes; when a title is vague, assume the most common meaning.',
  'Meetings or sessions: use their usual length. Building, implementing or delivering something: at least 60 minutes.',
  `Use only these minute values: ${STEPS.join(', ')}.`,
  'Reply with JSON only: {"estimates":[{"n":1,"minutes":30}, ...]}, one entry per numbered task.'
].join(' ');

type Fetch = typeof fetch;

/**
 * AI-schatter via de Mistral chat-API (JSON-modus). Alleen de titel (eerste regel) gaat mee, nooit notities of
 * checklist. Zonder MISTRAL_API_KEY bestaat hij niet en gebruikt de module alleen de regel-heuristiek.
 */
/** Korte, veilige omschrijving uit de foutbody van de aanbieder: alleen een soort of code, afgekapt. */
async function reason(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { type?: unknown; code?: unknown; error?: { type?: unknown; code?: unknown } };
    const kind = [body.type, body.code, body.error?.type, body.error?.code].find((v) => typeof v === 'string' || typeof v === 'number');
    return kind === undefined ? '' : ` (${String(kind).replace(/[^\w .:-]/g, '').slice(0, 60)})`;
  } catch {
    return '';
  }
}

export function createEstimator(env: Record<string, string | undefined>, fetchImpl: Fetch = fetch, retryScaleMs = 1000): Estimator | null {
  const key = env.MISTRAL_API_KEY?.trim();
  if (!key) return null;
  const model = env.DAGPLANNING_MODEL?.trim() || DEFAULT_MODEL;
  const base = (env.MISTRAL_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, '');

  return async (titles) => {
    if (titles.length === 0) return [];
    const batch = titles.slice(0, MAX_BATCH);
    const list = batch.map((t, i) => `${i + 1}. ${t}`).join('\n');
    try {
      const call = () =>
        fetchImpl(`${base}/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 2000,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: SYSTEM },
              { role: 'user', content: `Tasks:\n${list}` }
            ]
          }),
          signal: AbortSignal.timeout(60_000)
        });
      let res = await call();
      // Druk bij de aanbieder (429) is vaak na een paar tellen voorbij: één herkansing, daarna pas opgeven.
      if (res.status === 429) {
        const wait = Math.min(Math.max(Number(res.headers.get('retry-after')) || 0, 2), 8);
        await new Promise((r) => setTimeout(r, wait * retryScaleMs));
        res = await call();
      }
      if (!res.ok) {
        // Status en foutsoort van de aanbieder loggen (bijv. een limiet van het abonnement), nooit titels of de sleutel.
        console.error(`[dagplanning] schatten mislukt: HTTP ${res.status}${await reason(res)}`);
        return null;
      }
      const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') return null;
      const parsed = Output.safeParse(JSON.parse(content));
      if (!parsed.success) return null;
      const byN = new Map(parsed.data.estimates.map((e) => [e.n, e.minutes]));
      return batch.map((_, i) => {
        const v = byN.get(i + 1);
        return typeof v === 'number' && v > 0 ? snap(v) : 0;
      });
    } catch (err) {
      console.error('[dagplanning] schatten mislukt:', err instanceof Error ? err.name : 'onbekend');
      return null;
    }
  };
}
