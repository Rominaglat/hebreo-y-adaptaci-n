import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  markActivity,
  markFullAuth,
  isFreshAuth,
} from './sessionGuard';

describe('sessionGuard sudo mode', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  it('isFreshAuth returns false when never stamped', () => {
    expect(isFreshAuth()).toBe(false);
  });

  it('isFreshAuth returns true within the freshness window', () => {
    markFullAuth();
    expect(isFreshAuth(5)).toBe(true);
  });

  it('isFreshAuth returns false past the freshness window', () => {
    const past = Date.now() - 10 * 60_000;
    sessionStorage.setItem('security.lastFullAuthAt', String(past));
    expect(isFreshAuth(5)).toBe(false);
  });

  it('markActivity writes a non-empty value', () => {
    markActivity();
    expect(sessionStorage.getItem('security.lastActivityAt')).toMatch(/^\d+$/);
  });
});
