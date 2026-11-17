import { describe, expect, it, vi } from 'vitest';
import { createUpdateChecker, shouldAutoReload, shouldCheckForUpdate } from './updates';
import { initialUpdateState, isBarVisible, withDismissed, withNewVersion } from './updateStore';

describe('shouldAutoReload', () => {
  it('reloads when there was no recent automatic reload', () => {
    expect(shouldAutoReload(null, 1_000_000)).toBe(true);
    expect(shouldAutoReload(1_000_000 - 61_000, 1_000_000)).toBe(true);
  });
  it('refuses a second automatic reload within a minute (no reload loop)', () => {
    expect(shouldAutoReload(1_000_000 - 5_000, 1_000_000)).toBe(false);
  });
});

describe('shouldCheckForUpdate', () => {
  it('allows the first check and checks after 5 minutes', () => {
    expect(shouldCheckForUpdate(null, 1_000_000)).toBe(true);
    expect(shouldCheckForUpdate(1_000_000 - 5 * 60_000, 1_000_000)).toBe(true);
  });
  it('throttles checks within 5 minutes', () => {
    expect(shouldCheckForUpdate(1_000_000 - 4 * 60_000, 1_000_000)).toBe(false);
  });
});

describe('createUpdateChecker', () => {
  it('calls registration.update() at most once per gap', async () => {
    let t = 1_000_000;
    const update = vi.fn().mockResolvedValue(undefined);
    const check = createUpdateChecker({ getRegistration: async () => ({ update }), now: () => t });
    expect(await check()).toBe(true);
    t += 60_000;
    expect(await check()).toBe(false);
    t += 5 * 60_000;
    expect(await check()).toBe(true);
    expect(update).toHaveBeenCalledTimes(2);
  });
  it('ignores network errors silently', async () => {
    const check = createUpdateChecker({
      getRegistration: async () => ({ update: () => Promise.reject(new TypeError('Failed to fetch')) }),
      now: () => 1
    });
    await expect(check()).resolves.toBe(false);
  });
  it('does nothing without a registration', async () => {
    const check = createUpdateChecker({ getRegistration: async () => undefined, now: () => 1 });
    await expect(check()).resolves.toBe(false);
  });
});

describe('update bar state', () => {
  it('is hidden until a new version arrives', () => {
    expect(isBarVisible(initialUpdateState)).toBe(false);
  });
  it('goes pending -> dismissed -> visible again for a newer version', () => {
    const pending = withNewVersion(initialUpdateState);
    expect(isBarVisible(pending)).toBe(true);
    const dismissed = withDismissed(pending);
    expect(isBarVisible(dismissed)).toBe(false);
    expect(isBarVisible(withNewVersion(dismissed))).toBe(true);
  });
});
