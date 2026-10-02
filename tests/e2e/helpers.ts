import type { Page } from '@playwright/test';
import type { RawEdge, RawEntity } from '../../server/postgram.js';
import { FIXTURE_IDS } from '../mock-postgram/fixtures.js';

export { FIXTURE_IDS };

export async function reset(): Promise<void> {
  const res = await fetch('http://localhost:4010/__reset', { method: 'POST' });
  if (!res.ok) throw new Error(`POST /__reset failed: ${res.status}`);
}

export async function state(): Promise<{ entities: RawEntity[]; edges: RawEdge[] }> {
  const res = await fetch('http://localhost:4010/__state');
  if (!res.ok) throw new Error(`GET /__state failed: ${res.status}`);
  return res.json();
}

export async function bump(id: string): Promise<{ entity: RawEntity }> {
  const res = await fetch(`http://localhost:4010/__bump/${encodeURIComponent(id)}`, { method: 'POST' });
  if (!res.ok) throw new Error(`POST /__bump/${id} failed: ${res.status}`);
  return res.json();
}

export async function waitForSw(page: Page): Promise<void> {
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return;
    await navigator.serviceWorker.ready;
  });
}
