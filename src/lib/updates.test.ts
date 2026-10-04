import { describe, expect, it } from 'vitest';
import { shouldAutoReload } from './updates';

describe('shouldAutoReload', () => {
  it('reloads when there was no recent automatic reload', () => {
    expect(shouldAutoReload(null, 1_000_000)).toBe(true);
    expect(shouldAutoReload(1_000_000 - 61_000, 1_000_000)).toBe(true);
  });
  it('refuses a second automatic reload within a minute (no reload loop)', () => {
    expect(shouldAutoReload(1_000_000 - 5_000, 1_000_000)).toBe(false);
  });
});
