import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import type { Config } from './config.js';
import type { PostgramClient } from './postgram.js';
import { HOURLY_LIMIT, cleanSteps, createAiRoutes, createBreakdown } from './ai.js';

const reply = (content: unknown, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }), {
    status,
    headers: { 'content-type': 'application/json' }
  });

describe('createBreakdown', () => {
  it('does not exist without a key or when switched off', () => {
    expect(createBreakdown({})).toBeNull();
    expect(createBreakdown({ MISTRAL_API_KEY: 'k', AI_BREAKDOWN: 'off' })).toBeNull();
  });

  it('sends only the title and returns cleaned steps', async () => {
    const fetchImpl = vi.fn(async () => reply({ steps: ['1. Open de mail', '- Zoek het adres', 'Open de mail', '  ', 'Schrijf één zin'] }));
    const bd = createBreakdown({ MISTRAL_API_KEY: 'k', BREAKDOWN_MODEL: 'm' }, fetchImpl as unknown as typeof fetch)!;
    expect(await bd('Mail Piet over de offerte', 'nl')).toEqual({ steps: ['Open de mail', 'Zoek het adres', 'Schrijf één zin'] });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.mistral.ai/v1/chat/completions');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('m');
    expect(body.messages[1].content).toBe('Task: Mail Piet over de offerte');
    expect(body.messages[0].content).toContain('Dutch');
  });

  it('reports a failure without throwing', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bd = (impl: () => Promise<Response>) => createBreakdown({ MISTRAL_API_KEY: 'k' }, vi.fn(impl) as unknown as typeof fetch)!;
    expect(await bd(async () => reply('x', 500))('A', 'en')).toEqual({ error: 'HTTP 500' });
    expect(await bd(async () => reply('not json'))('A', 'en')).toEqual({ error: 'geen geldige JSON' });
    expect(await bd(async () => reply({ steps: [] }))('A', 'en')).toEqual({ error: 'geen stappen' });
    expect(await bd(async () => Promise.reject(new TypeError('net')))('A', 'en')).toEqual({ error: 'TypeError' });
    // De titel komt nooit in de log.
    expect(err.mock.calls.flat().join(' ')).not.toContain('A ');
    err.mockRestore();
  });

  it('caps the number and length of steps', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Stap ${i}`);
    expect(cleanSteps(many)).toHaveLength(8);
    expect(cleanSteps(['x'.repeat(500)])[0]).toHaveLength(120);
    expect(cleanSteps([{ text: 'Uit object' }, 42, null])).toEqual(['Uit object']);
  });
});

describe('/api/ai routes', () => {
  const config: Config = {
    pgmApiUrl: 'https://postgram.example',
    pgmApiKey: 'k',
    auth: { mode: 'dev' } as Config['auth'],
    port: 0,
    staticDir: './does-not-exist',
    appTimezone: 'Europe/Amsterdam'
  };
  const h = { 'content-type': 'application/json', 'x-requested-with': 'taskgram' };

  it('reports status and answers 503 without AI', async () => {
    const app = createApp(config, {} as PostgramClient, { breakdown: null });
    expect(await (await app.request('/api/ai/status')).json()).toEqual({ breakdown: false });
    const res = await app.request('/api/ai/breakdown', { method: 'POST', headers: h, body: JSON.stringify({ title: 'A' }) });
    expect(res.status).toBe(503);
  });

  it('returns steps, validates input and maps failures to 502', async () => {
    const breakdown = vi.fn(async (title: string) => (title === 'kapot' ? { error: 'x' } : { steps: ['Doe iets'] }));
    const app = createApp(config, {} as PostgramClient, { breakdown });
    expect(await (await app.request('/api/ai/status')).json()).toEqual({ breakdown: true });
    const post = (body: unknown) => app.request('/api/ai/breakdown', { method: 'POST', headers: h, body: JSON.stringify(body) });
    const ok = await post({ title: 'Mail Piet', lang: 'en' });
    expect(await ok.json()).toEqual({ steps: ['Doe iets'] });
    expect(breakdown).toHaveBeenCalledWith('Mail Piet', 'en');
    expect((await post({ title: '' })).status).toBe(400);
    expect((await post({ title: 'A', notes: 'geheim' })).status).toBe(400);
    expect((await post({ title: 'kapot' })).status).toBe(502);
  });

  it('limits calls per hour', async () => {
    let t = 0;
    const api = createAiRoutes({ breakdown: async () => ({ steps: ['a'] }), now: () => t });
    const post = () => api.request('/breakdown', { method: 'POST', headers: h, body: JSON.stringify({ title: 'A' }) });
    for (let i = 0; i < HOURLY_LIMIT; i++) expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(429);
    t = 3_600_001;
    expect((await post()).status).toBe(200);
  });
});
