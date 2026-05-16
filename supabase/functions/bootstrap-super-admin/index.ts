import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight } from "../_shared/cors.ts";



serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  function jsonResponse(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing authorization header" }, 401);
    }

    // SEC-005 — verify signature via auth.getUser instead of decoding the
    // payload by hand. Anonymous key client + Authorization header is the
    // standard Supabase pattern.
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ error: "Invalid token" }, 401);
    }
    const userId = user.id;

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const fullNameInput = typeof body.fullName === "string" ? body.fullName.trim() : "";
    const fullName = fullNameInput.length > 120 ? fullNameInput.slice(0, 120) : fullNameInput;

    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Allow exactly one-time bootstrap: only when there are ZERO super_admin roles.
    const { count: superAdminCount, error: countError } = await adminClient
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "super_admin");

    if (countError) {
      console.error("bootstrap-super-admin: countError", countError);
      return jsonResponse({ error: "Failed to check initialization state" }, 500);
    }

    if ((superAdminCount ?? 0) > 0) {
      return jsonResponse(
        { error: "Already initialized", code: "ALREADY_INITIALIZED" },
        409,
      );
    }

    const { data: authUserData, error: authUserError } = await adminClient.auth.admin.getUserById(userId);
    if (authUserError || !authUserData?.user) {
      console.error("bootstrap-super-admin: authUserError", authUserError);
      return jsonResponse({ error: "User not found" }, 404);
    }

    const email = authUserData.user.email ?? "";
    const metadataName =
      typeof (authUserData.user.user_metadata as any)?.full_name === "string"
        ? String((authUserData.user.user_metadata as any).full_name)
        : "";

    const finalName = (fullName || metadataName || email).trim().slice(0, 120);

    // Ensure profile exists (helpful for UI)
    await adminClient
      .from("profiles")
      .upsert({
        id: userId,
        email,
        full_name: finalName || email,
      });

    // Clean slate: drop any existing role rows for this user, then insert
    // super_admin. (Single-tenant: no tenant scope needed.)
    const { error: deleteRolesError } = await adminClient
      .from("user_roles")
      .delete()
      .eq("user_id", userId);

    if (deleteRolesError) {
      console.error("bootstrap-super-admin: deleteRolesError", deleteRolesError);
      return jsonResponse({ error: "Failed to update roles" }, 500);
    }

    const { error: insertRoleError } = await adminClient
      .from("user_roles")
      .insert({
        user_id: userId,
        role: "super_admin",
      });

    if (insertRoleError) {
      console.error("bootstrap-super-admin: insertRoleError", insertRoleError);
      return jsonResponse({ error: "Failed to grant super admin" }, 500);
    }

    return jsonResponse({ success: true, userId });
  } catch (error: any) {
    console.error("bootstrap-super-admin: unexpected", error);
    return jsonResponse({ error: error?.message || "Internal server error" }, 500);
  }
});
