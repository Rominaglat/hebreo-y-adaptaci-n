import { describe, it, expect } from 'vitest';
import { shouldPing, PING_THROTTLE_MS } from './activityPing';

const NOW = 1_800_000_000_000;

describe('shouldPing', () => {
  it('pings on the first visit, when nothing was ever stored', () => {
    expect(shouldPing(null, NOW)).toBe(true);
  });

  it('stays quiet for an hour after the last ping', () => {
    expect(shouldPing(String(NOW - 60_000), NOW)).toBe(false);
    expect(shouldPing(String(NOW - (PING_THROTTLE_MS - 1)), NOW)).toBe(false);
  });

  it('pings again once the throttle window has elapsed', () => {
    expect(shouldPing(String(NOW - PING_THROTTLE_MS), NOW)).toBe(true);
  });

  it('pings rather than stays silent when the stored value is corrupt', () => {
    expect(shouldPing('not-a-number', NOW)).toBe(true);
    expect(shouldPing('', NOW)).toBe(true);
  });

  it('pings when the clock moved backwards, instead of locking out forever', () => {
    expect(shouldPing(String(NOW + 5 * PING_THROTTLE_MS), NOW)).toBe(true);
  });
});
