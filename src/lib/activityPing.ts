// Throttle for the "student opened the portal" ping. Pure so the decision is
// testable without a browser; the hook supplies localStorage and the clock.

export const PING_THROTTLE_MS = 60 * 60 * 1000;
export const PING_STORAGE_KEY = 'lifecycle:lastActivityPing';

/**
 * Once an hour is plenty: the win-back mail only looks at the day, so a finer
 * cadence would cost writes without changing a single decision.
 *
 * Anything we cannot make sense of — corrupt value, a clock that moved
 * backwards — resolves to "ping". Recording activity slightly too often is
 * harmless; failing to record it mails an active student a win-back note.
 */
export function shouldPing(storedValue: string | null, now: number): boolean {
  if (!storedValue) return true;
  const last = Number(storedValue);
  if (!Number.isFinite(last)) return true;
  const elapsed = now - last;
  if (elapsed < 0) return true;
  return elapsed >= PING_THROTTLE_MS;
}
