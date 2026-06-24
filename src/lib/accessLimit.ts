// Pure helpers for the access time-limit feature (single + bulk).
//
// These mirror the validation already performed by the `set_access_limit`
// action of the `admin-user-actions` edge function, so the UI rejects bad
// input before making any network calls. The edge function remains the
// source of truth and re-validates everything server-side.

export type AccessLimitMode = 'hours' | 'date' | 'clear';

/** The portion of the edge-function body that is shared across every user in
 * a bulk operation. The caller adds `userId` per user. */
export type AccessLimitBody =
  | { action: 'set_access_limit'; hours: number }
  | { action: 'set_access_limit'; expiresAt: string }
  | { action: 'set_access_limit'; clear: true };

export type BuildAccessLimitInput = {
  mode: AccessLimitMode;
  hours?: string;
  date?: string;
};

// Flat shape (not a discriminated union) on purpose: this project compiles with
// strictNullChecks off, where discriminated-union narrowing on `ok` doesn't fire.
// When `ok` is true, `body` is set; when false, `code` is set.
export type BuildAccessLimitResult = {
  ok: boolean;
  body?: AccessLimitBody;
  code?: 'invalid_hours' | 'invalid_date';
};

/** Time limits only apply to students and leads — admins/instructors/super_admins
 * are rejected by the backend, so we never offer the action for them. */
export function isTimeLimitEligible(role: string): boolean {
  return role === 'student' || role === 'lead';
}

/** Split a selection into the users a time limit can be applied to and the
 * users that must be skipped, preserving input order. */
export function partitionByTimeLimitEligibility<T extends { role: string }>(
  users: T[],
): { eligible: T[]; skipped: T[] } {
  const eligible: T[] = [];
  const skipped: T[] = [];
  for (const user of users) {
    (isTimeLimitEligible(user.role) ? eligible : skipped).push(user);
  }
  return { eligible, skipped };
}

/** Validate the dialog input and build the shared edge-function body, or
 * return a stable error code the caller can map to a localized message. */
export function buildAccessLimitBody(
  input: BuildAccessLimitInput,
  now: number = Date.now(),
): BuildAccessLimitResult {
  if (input.mode === 'clear') {
    return { ok: true, body: { action: 'set_access_limit', clear: true } };
  }

  if (input.mode === 'hours') {
    const h = Number(input.hours);
    if (input.hours === undefined || input.hours.trim() === '' || !Number.isFinite(h) || h <= 0) {
      return { ok: false, code: 'invalid_hours' };
    }
    return { ok: true, body: { action: 'set_access_limit', hours: h } };
  }

  // mode === 'date'
  if (!input.date) {
    return { ok: false, code: 'invalid_date' };
  }
  const d = new Date(input.date);
  if (isNaN(d.getTime()) || d.getTime() <= now) {
    return { ok: false, code: 'invalid_date' };
  }
  return { ok: true, body: { action: 'set_access_limit', expiresAt: d.toISOString() } };
}
