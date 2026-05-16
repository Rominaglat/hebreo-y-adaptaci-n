// Frontend session lifecycle hardening — Wave 3.
//
// Adds two safety nets:
//   - idle timeout: sign the user out after N minutes of no user activity.
//     Default 30 min; admins/super_admins get 15 min.
//   - sudo mode: track the last full-auth timestamp so high-risk operations
//     (delete user, role change, key rotation, MFA changes) can require a
//     fresh auth within the last 5 minutes.
//
// Pure utilities — no React. Wire from a top-level effect (see DashboardLayout).

import { supabase } from '@/integrations/supabase/client';

const IDLE_KEY = 'security.lastActivityAt';
const SUDO_KEY = 'security.lastFullAuthAt';

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
];

export interface SessionGuardOptions {
  /** Idle timeout in minutes before forcing sign-out. */
  idleTimeoutMin: number;
  /** Called right before sign-out fires; use to flush UI / inform the user. */
  onIdleTimeout?: () => void;
  /** Called when activity is detected (rare; for telemetry). */
  onActivity?: () => void;
}

let teardown: (() => void) | null = null;

export function startSessionGuard(opts: SessionGuardOptions): void {
  stopSessionGuard();

  // Initial timestamp on mount — treat mount as activity.
  markActivity();

  const timer = window.setInterval(() => {
    const last = readActivityAt();
    if (Date.now() - last > opts.idleTimeoutMin * 60_000) {
      opts.onIdleTimeout?.();
      // Sign out + clear local state.
      void supabase.auth.signOut();
      window.location.href = '/login?reason=idle';
    }
  }, 30_000);

  const onActivity = () => {
    markActivity();
    opts.onActivity?.();
  };

  for (const evt of ACTIVITY_EVENTS) {
    window.addEventListener(evt, onActivity, { passive: true });
  }

  teardown = () => {
    window.clearInterval(timer);
    for (const evt of ACTIVITY_EVENTS) {
      window.removeEventListener(evt, onActivity);
    }
  };
}

export function stopSessionGuard(): void {
  teardown?.();
  teardown = null;
}

export function markActivity(): void {
  try {
    sessionStorage.setItem(IDLE_KEY, String(Date.now()));
  } catch {
    // sessionStorage may be unavailable in privacy modes; silently degrade.
  }
}

function readActivityAt(): number {
  try {
    const v = sessionStorage.getItem(IDLE_KEY);
    return v ? Number(v) : Date.now();
  } catch {
    return Date.now();
  }
}

// ── Sudo mode ────────────────────────────────────────────────────────────────

/** Stamp the last successful interactive auth. Call from the sign-in handler. */
export function markFullAuth(): void {
  try {
    sessionStorage.setItem(SUDO_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/**
 * Has the user authenticated fresh within `maxAgeMin`? If false, gate
 * sensitive admin actions by prompting re-auth (handled at the call site).
 */
export function isFreshAuth(maxAgeMin = 5): boolean {
  try {
    const v = sessionStorage.getItem(SUDO_KEY);
    if (!v) return false;
    return Date.now() - Number(v) < maxAgeMin * 60_000;
  } catch {
    return false;
  }
}

/**
 * Convenience guard for sensitive UI affordances:
 *   const ok = await requireFreshAuth();
 *   if (!ok) return;
 *
 * The user is redirected to the re-auth modal (TODO: implement a modal; for
 * now we fall back to a confirm() prompt so callers can ship immediately).
 */
export async function requireFreshAuth(maxAgeMin = 5): Promise<boolean> {
  if (isFreshAuth(maxAgeMin)) return true;
  const ok = window.confirm(
    'פעולה זו דורשת אימות מחדש. להתנתק ולהתחבר שוב?',
  );
  if (ok) {
    void supabase.auth.signOut();
    window.location.href = '/login?reason=sudo';
  }
  return false;
}
