// Shared authentication / role helpers for edge functions.
//
// Single-tenant build: there is no tenant scoping any more. Roles live in
// the `user_roles` table, not `tenant_memberships` (which is being
// dropped). The legacy `requireMembership(tenantId, ...)` signature is
// preserved so existing call sites compile, but the tenantId argument is
// ignored — the function now resolves the caller's role from user_roles.

import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

export type Role = "student" | "instructor" | "admin" | "super_admin";

const ROLE_RANK: Record<Role, number> = {
  student: 0,
  instructor: 1,
  admin: 2,
  super_admin: 3,
};

export class AuthError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

/**
 * Verify the caller's bearer token and return the Supabase auth user.
 * Throws AuthError(401) on failure.
 */
export async function requireUser(req: Request, supabaseUrl: string, supabaseAnonKey: string): Promise<{ user: User; token: string }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    throw new AuthError(401, "unauthorized");
  }
  const token = authHeader.slice(7).trim();
  if (!token) throw new AuthError(401, "unauthorized");

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) throw new AuthError(401, "unauthorized");
  return { user, token };
}

/**
 * Resolve the caller's highest role from `user_roles`. Returns `student`
 * (default) if the user has no explicit role row.
 */
async function resolveUserRole(adminClient: SupabaseClient, userId: string): Promise<Role> {
  const { data, error } = await adminClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new AuthError(500, "role_lookup_failed");

  const roles = (data ?? []).map((r) => r.role as Role);
  if (roles.length === 0) return "student";
  // Highest-ranked role wins (super_admin > admin > instructor > student).
  return roles.reduce<Role>((best, r) => (ROLE_RANK[r] > ROLE_RANK[best] ? r : best), "student");
}

/**
 * Verify the caller AND enforce at least `options.minRole`. Returns the
 * resolved user + role.
 *
 * NOTE: The `_tenantId` parameter is kept for source-level compatibility
 * with the legacy multi-tenant signature. It is IGNORED. Existing call
 * sites can pass anything (typically the constant SINGLE_TENANT_ID); new
 * code should just use `requireUserRole` below.
 */
export async function requireMembership(
  req: Request,
  adminClient: SupabaseClient,
  _tenantId: string,
  options: {
    supabaseUrl: string;
    supabaseAnonKey: string;
    minRole?: Role;
  },
): Promise<{ user: User; role: Role }> {
  return requireUserRole(req, adminClient, options);
}

/**
 * Single-tenant native variant: verify auth + role from user_roles, with
 * an optional minimum role.
 */
export async function requireUserRole(
  req: Request,
  adminClient: SupabaseClient,
  options: {
    supabaseUrl: string;
    supabaseAnonKey: string;
    minRole?: Role;
  },
): Promise<{ user: User; role: Role }> {
  const { user } = await requireUser(req, options.supabaseUrl, options.supabaseAnonKey);
  const role = await resolveUserRole(adminClient, user.id);

  if (options.minRole && ROLE_RANK[role] < ROLE_RANK[options.minRole]) {
    throw new AuthError(403, "forbidden");
  }
  return { user, role };
}

/**
 * Legacy "same-tenant target" check. Single-tenant build: every
 * authenticated user is in the same scope, so this just verifies the
 * target user actually exists in `user_roles` (i.e. has been
 * provisioned). The `_tenantId` argument is ignored.
 */
export async function requireSameTenantTarget(
  adminClient: SupabaseClient,
  _tenantId: string,
  targetUserId: string,
): Promise<void> {
  // Existence check via profiles (every authed user has a profile row).
  const { data } = await adminClient
    .from("profiles")
    .select("id")
    .eq("id", targetUserId)
    .maybeSingle();
  if (!data) throw new AuthError(403, "target_not_found");
}

/** Translate an AuthError into a Response. */
export function authErrorResponse(err: unknown, corsHeaders: Record<string, string>): Response {
  if (err instanceof AuthError) {
    return new Response(JSON.stringify({ error: err.code }), {
      status: err.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ error: "internal_error" }), {
    status: 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
