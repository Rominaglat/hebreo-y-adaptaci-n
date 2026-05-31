// SEC-013 hard-enforce — feature-flagged AAL2 gate for admins.
//
// Activated by VITE_REQUIRE_MFA_FOR_ADMINS=1 in Vercel env. When ON:
//   - Admins / super_admins WITHOUT a verified TOTP factor are redirected
//     to /settings/security on every navigation.
//   - Admins WITH a TOTP factor must have stepped up to AAL2 in their
//     session; otherwise they're redirected to a step-up prompt (handled by
//     /settings/security which calls supabase.auth.mfa.challenge()).
//
// When OFF (default), the gate is a no-op so we don't lock anyone out
// during the rollout window. Flip the env var ONCE every active admin has
// enrolled (verify via the audit doc Secrets / status board).

import { supabase } from '@/integrations/supabase/client';
import { withTimeout } from '@/lib/utils';

export interface MfaStatus {
  aal: 'aal1' | 'aal2' | 'unknown';
  hasVerifiedTotp: boolean;
  required: boolean;
}

export async function getMfaStatus(): Promise<MfaStatus> {
  const required = (import.meta.env.VITE_REQUIRE_MFA_FOR_ADMINS as string) === '1';
  try {
    // Hard-bound these auth calls: the underlying GoTrue requests can stall
    // forever on token-refresh races or transient outages. If they don't
    // resolve quickly we fail-open below — never block the entire UI on the
    // MFA gate while the rest of the app is ready to render.
    const { data: aalData } = await withTimeout(
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      6000,
      'mfa.getAuthenticatorAssuranceLevel'
    );
    const aal = (aalData?.currentLevel as 'aal1' | 'aal2' | null) ?? 'unknown';
    const { data: factors } = await withTimeout(
      supabase.auth.mfa.listFactors(),
      6000,
      'mfa.listFactors'
    );
    const hasVerifiedTotp = (factors?.totp ?? []).some((f) => f.status === 'verified');
    return { aal, hasVerifiedTotp, required };
  } catch {
    // Failing-open here is intentional — never lock users out because the
    // MFA API call hiccupped (or timed out). The Dashboard TOTP toggle is
    // the real switch.
    return { aal: 'unknown', hasVerifiedTotp: false, required };
  }
}

/**
 * Returns a redirect path if the admin must complete MFA before
 * proceeding. Returns null when the route may render as-is.
 *
 * Use only after we know the user is admin/super_admin AND the env flag
 * is on. ProtectedRoute does both checks.
 */
export function mfaRedirectFor(status: MfaStatus, currentPath: string): string | null {
  if (!status.required) return null;
  if (currentPath === '/settings/security') return null; // never trap on the enrollment page
  if (!status.hasVerifiedTotp) return '/settings/security?reason=mfa-required';
  if (status.aal !== 'aal2') return '/settings/security?reason=mfa-step-up';
  return null;
}
