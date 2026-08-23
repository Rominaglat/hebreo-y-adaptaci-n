// Pure logic for lifecycle emails. No I/O — unit-tested here and imported by
// the send-lifecycle-emails edge function.

export type LifecycleKind = 'welcome_6h' | 'tips_48h' | 'inactive_7d';

export interface OnboardingWindow {
  /** Signups at or before this instant are due the email. */
  createdBefore: string;
  /* NOTE: both bounds are ISO strings for the PostgREST query, but every
     comparison below goes through Date — see `ms()`. */
  /**
   * Signups must also be AFTER this instant. This is a blast guard, not a
   * behavioral filter: if cron is down for days, we must not suddenly mail
   * everyone who signed up in the meantime with a stale "welcome" note.
   */
  createdAfter: string;
}

const HOUR_MS = 3_600_000;

/** delay = how long after signup the mail is due; grace = how far back we still catch up. */
const ONBOARDING_HOURS: Record<'welcome_6h' | 'tips_48h', { delay: number; grace: number }> = {
  welcome_6h: { delay: 6, grace: 72 },
  tips_48h: { delay: 48, grace: 24 * 7 },
};

export function onboardingWindow(kind: LifecycleKind, now: Date): OnboardingWindow {
  const spec = ONBOARDING_HOURS[kind as 'welcome_6h' | 'tips_48h'];
  if (!spec) throw new Error(`onboardingWindow: ${kind} is not an onboarding email`);
  return {
    createdBefore: new Date(now.getTime() - spec.delay * HOUR_MS).toISOString(),
    createdAfter: new Date(now.getTime() - spec.grace * HOUR_MS).toISOString(),
  };
}

export interface LifecycleCandidate {
  userId: string;
  createdAt: string;
  /** Last time the student opened the portal. Null for accounts predating tracking. */
  lastActiveAt: string | null;
  /** False once the student uses the unsubscribe link. Absent means opted in. */
  emailsEnabled?: boolean;
}

/**
 * The instant we treat as the student's last sign of life. Falling back to
 * signup means accounts created before activity tracking existed still become
 * eligible for the inactivity email instead of being invisible forever.
 */
export function lastSeenAt(c: LifecycleCandidate): string {
  return c.lastActiveAt ?? c.createdAt;
}

/**
 * Second half of the ledger's UNIQUE (user_id, kind, dedupe_key).
 *
 * Onboarding emails use a constant, so a user can only ever receive one.
 * The inactivity email is keyed to the UTC day activity stopped: when a
 * student returns, `lastActiveAt` moves and the key changes, which is what
 * makes "once per absence" work without any reset bookkeeping.
 */
export function dedupeKey(kind: LifecycleKind, c: LifecycleCandidate): string {
  if (kind !== 'inactive_7d') return 'once';
  // Derived from the instant, not the text, so the key does not depend on the
  // offset the database happens to render — see `ms()`.
  return new Date(lastSeenAt(c)).toISOString().slice(0, 10);
}

export const INACTIVITY_DAYS = 7;

/**
 * Every timestamp comparison goes through here.
 *
 * PostgREST renders timestamptz as '2026-08-23T09:00:00.123456+00:00' while
 * Date#toISOString gives '...Z', and the database's session timezone decides
 * the offset. Comparing those as text is only accidentally right for UTC and
 * silently wrong for any other offset — so we always compare instants.
 */
function ms(iso: string): number {
  return new Date(iso).getTime();
}

export interface SelectOptions {
  now: Date;
  /** When the feature shipped. Onboarding mail is only for accounts created after. */
  startAt: string;
  /** Ledger keys already written, from `ledgerKey`. */
  alreadySent: Set<string>;
}

export interface Selected {
  candidate: LifecycleCandidate;
  dedupeKey: string;
}

/** Mirrors the ledger's UNIQUE (user_id, kind, dedupe_key). */
export function ledgerKey(userId: string, kind: LifecycleKind, key: string): string {
  return `${userId}|${kind}|${key}`;
}

export function selectRecipients(
  kind: LifecycleKind,
  candidates: LifecycleCandidate[],
  opts: SelectOptions,
): Selected[] {
  const nowMs = opts.now.getTime();
  const startAtMs = ms(opts.startAt);
  const isOnboarding = kind !== 'inactive_7d';
  const window = isOnboarding ? onboardingWindow(kind, opts.now) : null;
  const inactiveBefore = nowMs - INACTIVITY_DAYS * 24 * HOUR_MS;

  const due = (c: LifecycleCandidate): boolean => {
    if (window) {
      // The onboarding pair is unconditional on behaviour by design — the only
      // gates are signup age, the catch-up grace, and the ship date.
      const created = ms(c.createdAt);
      if (created < startAtMs) return false;
      return created <= ms(window.createdBefore) && created > ms(window.createdAfter);
    }
    // Inactivity applies to the whole roster, including accounts that predate
    // the feature — for those, `lastSeenAt` falls back to signup.
    return ms(lastSeenAt(c)) <= inactiveBefore;
  };

  const out: Selected[] = [];
  for (const c of candidates) {
    if (c.emailsEnabled === false) continue;
    if (!due(c)) continue;
    const key = dedupeKey(kind, c);
    if (opts.alreadySent.has(ledgerKey(c.userId, kind, key))) continue;
    out.push({ candidate: c, dedupeKey: key });
  }
  return out;
}
