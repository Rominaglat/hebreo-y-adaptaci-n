// Single-tenant deployment constants.
//
// Phase 1 of the multi-tenancy removal — see commit
// "feat(single-tenant): Phase 1". The DB schema still has tenant_id
// everywhere; we just always use this one. Rollback is `git revert`
// of that commit — no DB migrations to undo.
//
// New customer deployments can override either constant via Vite env
// vars set in the Vercel project (preferred path — no code changes per
// customer). The fallbacks match the Learning Portal master tenant.
//
// Required env vars per deployment:
//   VITE_TENANT_ID   = the single tenants.id this build talks to
//   VITE_TENANT_SLUG = the tenants.slug (used for branding fallback)
//
// Long-term (Phase 2) the column will be dropped and this file goes
// away entirely.

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const DEFAULT_TENANT_SLUG = "default";

export const SINGLE_TENANT_ID: string =
  (import.meta.env.VITE_TENANT_ID as string | undefined) ?? DEFAULT_TENANT_ID;

export const SINGLE_TENANT_SLUG: string =
  (import.meta.env.VITE_TENANT_SLUG as string | undefined) ?? DEFAULT_TENANT_SLUG;
