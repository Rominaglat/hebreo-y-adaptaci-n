import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { runFullScan } from "../_shared/skill-scanner.ts";
import { getCorsHeaders, handlePreflight } from "../_shared/cors.ts";


async function verifyAndGetUserId(supabaseUrl: string, supabaseAnonKey: string, token: string): Promise<string | null> {
  try {
    const client = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

async function logAudit(adminClient: any, params: {
  action: string;
  skill_id: string | null;
  version_id: string | null;
  actor_id: string;
  notes?: string | null;
  metadata?: any;
}) {
  try {
    await adminClient.from("skill_audit_log").insert({
      action: params.action,
      skill_id: params.skill_id,
      version_id: params.version_id,
      actor_id: params.actor_id,
      notes: params.notes || null,
      metadata: params.metadata || null,
    });
  } catch (err) {
    console.error("Audit log failed (non-fatal):", err);
  }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const adminUserId = await verifyAndGetUserId(supabaseUrl, supabaseAnonKey, token);
    if (!adminUserId) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });

    const { data: membershipData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", adminUserId)
      .in("role", ["admin", "super_admin"]);

    if (!membershipData || membershipData.length === 0) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isSuperAdmin = membershipData.some(m => m.role === "super_admin");
    const body = await req.json();
    const { action } = body;

    // ========================================
    // ACTION: approve
    // ========================================
    if (action === "approve") {
      const { version_id, notes } = body;
      if (!version_id) {
        return new Response(JSON.stringify({ error: "version_id is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: version } = await adminClient
        .from("skill_versions")
        .select("id, skill_id")
        .eq("id", version_id)
        .single();

      if (!version) {
        return new Response(JSON.stringify({ error: "Version not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await adminClient.from("skill_versions").update({
        status: "approved",
        reviewed_by: adminUserId,
        review_notes: notes || null,
        reviewed_at: new Date().toISOString(),
      }).eq("id", version_id);

      await adminClient.from("skills").update({
        status: "approved",
        current_version_id: version_id,
      }).eq("id", version.skill_id);

      await logAudit(adminClient, {
        action: "approve",
        skill_id: version.skill_id,
        version_id,
        actor_id: adminUserId,
        notes,
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========================================
    // ACTION: reject
    // ========================================
    if (action === "reject") {
      const { version_id, notes } = body;
      if (!version_id) {
        return new Response(JSON.stringify({ error: "version_id is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: version } = await adminClient
        .from("skill_versions")
        .select("id, skill_id")
        .eq("id", version_id)
        .single();

      if (!version) {
        return new Response(JSON.stringify({ error: "Version not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await adminClient.from("skill_versions").update({
        status: "rejected",
        reviewed_by: adminUserId,
        review_notes: notes || null,
        reviewed_at: new Date().toISOString(),
      }).eq("id", version_id);

      const { data: skill } = await adminClient
        .from("skills")
        .select("current_version_id, status")
        .eq("id", version.skill_id)
        .single();

      if (skill && !skill.current_version_id) {
        await adminClient.from("skills").update({ status: "rejected" }).eq("id", version.skill_id);
      }

      await logAudit(adminClient, {
        action: "reject",
        skill_id: version.skill_id,
        version_id,
        actor_id: adminUserId,
        notes,
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========================================
    // ACTION: feature (toggle featured)
    // ========================================
    if (action === "feature") {
      const { skill_id, is_featured } = body;
      if (!skill_id) {
        return new Response(JSON.stringify({ error: "skill_id is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const newFeatured = is_featured ?? true;
      await adminClient.from("skills").update({ is_featured: newFeatured }).eq("id", skill_id);

      await logAudit(adminClient, {
        action: newFeatured ? "feature" : "unfeature",
        skill_id,
        version_id: null,
        actor_id: adminUserId,
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========================================
    // ACTION: rescan (actually re-runs Layer 1 + 2)
    // ========================================
    if (action === "rescan") {
      const { version_id } = body;
      if (!version_id) {
        return new Response(JSON.stringify({ error: "version_id is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: version } = await adminClient
        .from("skill_versions")
        .select("id, skill_id, file_path")
        .eq("id", version_id)
        .single();

      if (!version) {
        return new Response(JSON.stringify({ error: "Version not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Mark as scanning
      await adminClient.from("skill_versions").update({ status: "scanning" }).eq("id", version_id);
      await adminClient.from("skills").update({ status: "scanning" }).eq("id", version.skill_id);

      // Download file content from storage
      const { data: fileData, error: downloadErr } = await adminClient.storage
        .from("skill-files")
        .download(version.file_path);

      if (downloadErr || !fileData) {
        await adminClient.from("skill_versions").update({ status: "submitted" }).eq("id", version_id);
        await adminClient.from("skills").update({ status: "submitted" }).eq("id", version.skill_id);
        return new Response(JSON.stringify({ error: "File not found in storage" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const content = await fileData.text();
      const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");

      // Run full scan (Layer 1 + Layer 2 with retry)
      const scanResult = await runFullScan(content, anthropicApiKey);
      console.log(`Rescan: status=${scanResult.overall_status} failed=${scanResult.scan_failed}`);

      const overallStatus = scanResult.overall_status;

      await adminClient.from("skill_versions").update({
        status: overallStatus,
        scan_result: scanResult,
        scan_completed_at: new Date().toISOString(),
      }).eq("id", version_id);

      // Update skill: only auto-set current_version_id if approved AND skill has no current
      const { data: skillRow } = await adminClient
        .from("skills")
        .select("current_version_id")
        .eq("id", version.skill_id)
        .single();

      const skillUpdate: any = { status: overallStatus };
      if (overallStatus === "approved" && !skillRow?.current_version_id) {
        skillUpdate.current_version_id = version_id;
      }
      await adminClient.from("skills").update(skillUpdate).eq("id", version.skill_id);

      await logAudit(adminClient, {
        action: "rescan",
        skill_id: version.skill_id,
        version_id,
        actor_id: adminUserId,
        metadata: {
          new_status: overallStatus,
          scan_failed: scanResult.scan_failed,
          layer1_critical: scanResult.layer1.critical_count,
          layer2_risk: scanResult.layer2.risk_level,
        },
      });

      return new Response(JSON.stringify({
        success: true,
        status: overallStatus,
        scan_result: scanResult,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========================================
    // ACTION: get_version_content (admin can view any version)
    // ========================================
    if (action === "get_version_content") {
      const { version_id } = body;
      if (!version_id) {
        return new Response(JSON.stringify({ error: "version_id is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: version } = await adminClient
        .from("skill_versions")
        .select("file_path")
        .eq("id", version_id)
        .single();

      if (!version) {
        return new Response(JSON.stringify({ error: "Version not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: fileData, error: downloadErr } = await adminClient.storage
        .from("skill-files")
        .download(version.file_path);

      if (downloadErr || !fileData) {
        return new Response(JSON.stringify({ error: "Failed to download file" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const content = await fileData.text();

      return new Response(JSON.stringify({ content }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========================================
    // ACTION: delete
    // ========================================
    if (action === "delete") {
      if (!isSuperAdmin) {
        return new Response(JSON.stringify({ error: "Super admin access required for deletion" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { skill_id } = body;
      if (!skill_id) {
        return new Response(JSON.stringify({ error: "skill_id is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: skillSnapshot } = await adminClient
        .from("skills")
        .select("name")
        .eq("id", skill_id)
        .single();

      await adminClient.from("skills").update({ current_version_id: null }).eq("id", skill_id);

      const { data: versions } = await adminClient
        .from("skill_versions")
        .select("file_path")
        .eq("skill_id", skill_id);

      if (versions && versions.length > 0) {
        const paths = versions.map(v => v.file_path);
        await adminClient.storage.from("skill-files").remove(paths);
      }

      await logAudit(adminClient, {
        action: "delete",
        skill_id: null, // skill is being deleted; nullify FK
        version_id: null,
        actor_id: adminUserId,
        metadata: { deleted_skill_id: skill_id, deleted_skill_name: skillSnapshot?.name },
      });

      await adminClient.from("skills").delete().eq("id", skill_id);

      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========================================
    // ACTION: list_all (admin view — all statuses, paginated)
    // ========================================
    if (action === "list_all") {
      const { status: filterStatus, page = 0, page_size = 50, search } = body;

      let query = adminClient
        .from("skills")
        .select("*, skill_versions(*)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * page_size, (page + 1) * page_size - 1);

      if (filterStatus) {
        query = query.eq("status", filterStatus);
      }

      if (search) {
        query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
      }

      const { data, error, count } = await query;

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ skills: data, total: count }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========================================
    // ACTION: list_audit_log
    // ========================================
    if (action === "list_audit_log") {
      const { skill_id, page = 0, page_size = 50 } = body;

      let query = adminClient
        .from("skill_audit_log")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * page_size, (page + 1) * page_size - 1);

      if (skill_id) {
        query = query.eq("skill_id", skill_id);
      }

      const { data, error, count } = await query;

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ entries: data, total: count }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("Unhandled error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
