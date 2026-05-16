// personality-admin-actions — admin-only mutations on personality_assessments.
//
// Currently supports a single action:
//   reset_personality — soft-deletes the target user's latest active assessment
//                       in the requesting admin's tenant, allowing them to retake
//                       immediately (bypasses the 7-day cooldown).
//
// Auth model mirrors `admin-user-actions`:
//   1. JWT → user_id
//   2. Pull user_roles for the caller
//   3. Require admin or super_admin role
//   4. Verify the *target* user has a user_roles row (exists in this single-tenant app)
//
// Deploy with --no-verify-jwt.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight } from "../_shared/cors.ts";


interface RequestBody {
  action: "reset_personality";
  target_user_id: string;
  // tenant_id is kept in the type for API back-compat but is ignored server-side.
  tenant_id?: string;
}

async function verifyAndGetUserId(
  supabaseUrl: string,
  supabaseAnonKey: string,
  token: string,
): Promise<string | null> {
  try {
    const client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}


serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  function jsonResp(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResp({ error: "Missing authorization header" }, 401);
    }
    const token = authHeader.slice(7);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const adminUserId = await verifyAndGetUserId(supabaseUrl, supabaseAnonKey, token);
    if (!adminUserId) {
      return jsonResp({ error: "Invalid or expired token" }, 401);
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const body = (await req.json()) as Partial<RequestBody>;
    const { action, target_user_id } = body;

    if (action !== "reset_personality") {
      return jsonResp({ error: `unsupported_action:${action}` }, 400);
    }
    if (!target_user_id || typeof target_user_id !== "string") {
      return jsonResp({ error: "target_user_id is required" }, 400);
    }

    // Single-tenant: caller must be admin/super_admin in user_roles.
    const { data: callerRoles, error: callerError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", adminUserId)
      .in("role", ["admin", "super_admin"]);

    if (callerError || !callerRoles || callerRoles.length === 0) {
      return jsonResp({ error: "Admin role required" }, 403);
    }

    // Target user must exist (i.e. have at least one user_roles row).
    const { data: targetRole } = await adminClient
      .from("user_roles")
      .select("id")
      .eq("user_id", target_user_id)
      .limit(1)
      .maybeSingle();

    if (!targetRole) {
      return jsonResp({ error: "target_user_not_found" }, 404);
    }

    // Find the most recent NON-VOIDED assessment for this user.
    const { data: latest, error: fetchError } = await adminClient
      .from("personality_assessments")
      .select("id, created_at")
      .eq("user_id", target_user_id)
      .is("voided_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      console.error("Failed to fetch latest assessment:", fetchError);
      return jsonResp({ error: "fetch_failed", detail: fetchError.message }, 500);
    }
    if (!latest) {
      return jsonResp({ error: "no_active_assessment" }, 404);
    }

    const { data: updated, error: updateError } = await adminClient
      .from("personality_assessments")
      .update({
        voided_at: new Date().toISOString(),
        voided_by: adminUserId,
      })
      .eq("id", latest.id)
      .select("id, voided_at, voided_by")
      .single();

    if (updateError) {
      console.error("Failed to void assessment:", updateError);
      return jsonResp({ error: "void_failed", detail: updateError.message }, 500);
    }

    return jsonResp(
      {
        success: true,
        voided_assessment_id: updated.id,
        voided_at: updated.voided_at,
        voided_by: updated.voided_by,
      },
      200,
    );
  } catch (e) {
    console.error("personality-admin-actions error:", e);
    return jsonResp(
      { error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});
