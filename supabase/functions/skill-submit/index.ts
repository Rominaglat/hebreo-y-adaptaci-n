import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { runFullScan } from "../_shared/skill-scanner.ts";
import { getCorsHeaders, handlePreflight } from "../_shared/cors.ts";


async function sha256(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifyAndGetUser(supabaseUrl: string, supabaseAnonKey: string, token: string) {
  const client = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
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

    const user = await verifyAndGetUser(supabaseUrl, supabaseAnonKey, token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });
    const body = await req.json();
    const { action } = body;

    // ========================================
    // ACTION: submit
    // ========================================
    if (action === "submit") {
      const { name, description, long_description, category, tags, trigger_pattern, icon_name, file_content, skill_id } = body;

      if (!file_content || !name) {
        return new Response(JSON.stringify({ error: "name and file_content are required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // SEC-020 — content-type sniff.
      // file_content is the markdown skill payload. Reject:
      //   - non-string types
      //   - oversized payloads (256 KB cap; was 500 KB)
      //   - NULL bytes (indicates binary)
      //   - obvious HTML/script payloads pretending to be markdown
      if (typeof file_content !== "string") {
        return new Response(JSON.stringify({ error: "file_content must be a string" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (file_content.length > 256 * 1024) {
        return new Response(JSON.stringify({ error: "File content exceeds 256KB limit" }), {
          status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (file_content.includes("\x00")) {
        return new Response(JSON.stringify({ error: "File content must be valid UTF-8 text" }), {
          status: 415, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // First 4 KB sniff: a markdown skill file should start with frontmatter or text.
      // Block <script> / <iframe> / <object> at the head — those are very strong
      // signals of an HTML/JS payload trying to be served as markdown.
      const sniff = file_content.slice(0, 4096).toLowerCase();
      const htmlLike = /<\s*(script|iframe|object|embed|svg|meta|link)\b/.test(sniff);
      if (htmlLike) {
        return new Response(JSON.stringify({ error: "File content does not look like Markdown" }), {
          status: 415, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const fileHash = await sha256(file_content);
      let targetSkillId = skill_id;
      let version = 1;

      if (targetSkillId) {
        // New version for existing skill — verify ownership
        const { data: existingSkill } = await adminClient
          .from("skills")
          .select("author_id")
          .eq("id", targetSkillId)
          .single();

        if (!existingSkill || existingSkill.author_id !== user.id) {
          return new Response(JSON.stringify({ error: "Skill not found or not owned by you" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: existingVersions } = await adminClient
          .from("skill_versions")
          .select("version")
          .eq("skill_id", targetSkillId)
          .order("version", { ascending: false })
          .limit(1);

        version = (existingVersions?.[0]?.version || 0) + 1;

        await adminClient.from("skills").update({
          name, description, long_description, category,
          tags: tags || [],
          trigger_pattern, icon_name,
          status: "scanning",
        }).eq("id", targetSkillId);
      } else {
        const { data: newSkill, error: skillErr } = await adminClient
          .from("skills")
          .insert({
            name, description, long_description, category: category || "general",
            tags: tags || [],
            trigger_pattern, icon_name,
            author_id: user.id,
            status: "scanning",
          })
          .select("id")
          .single();

        if (skillErr) {
          console.error("Error creating skill:", skillErr);
          return new Response(JSON.stringify({ error: "Failed to create skill" }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        targetSkillId = newSkill.id;
      }

      // Upload file
      const filePath = `skills/${targetSkillId}/v${version}/skill.md`;
      const fileBlob = new Blob([file_content], { type: "text/markdown" });

      const { error: uploadErr } = await adminClient.storage
        .from("skill-files")
        .upload(filePath, fileBlob, { upsert: true });

      if (uploadErr) {
        console.error("Upload error:", uploadErr);
        return new Response(JSON.stringify({ error: "Failed to upload file" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const contentPreview = file_content.substring(0, 500);
      const { data: newVersion, error: versionErr } = await adminClient
        .from("skill_versions")
        .insert({
          skill_id: targetSkillId,
          version,
          file_path: filePath,
          file_hash: fileHash,
          content_preview: contentPreview,
          status: "scanning",
          submitted_by: user.id,
        })
        .select("id")
        .single();

      if (versionErr) {
        console.error("Version creation error:", versionErr);
        return new Response(JSON.stringify({ error: "Failed to create version record" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ---- Run Security Scan ----
      console.log(`Scanning skill ${targetSkillId} version ${version}...`);
      const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (!anthropicApiKey) {
        console.warn("ANTHROPIC_API_KEY not set, Layer 2 scan will be skipped");
      }

      const scanResult = await runFullScan(file_content, anthropicApiKey);
      console.log(`Scan: layer1.critical=${scanResult.layer1.critical_count} layer2.risk=${scanResult.layer2.risk_level} status=${scanResult.overall_status} failed=${scanResult.scan_failed}`);

      const overallStatus = scanResult.overall_status;

      await adminClient.from("skill_versions").update({
        status: overallStatus === "submitted" ? "submitted" : overallStatus,
        scan_result: scanResult,
        scan_completed_at: new Date().toISOString(),
      }).eq("id", newVersion.id);

      const updateData: any = { status: overallStatus };
      if (overallStatus === "approved") {
        updateData.current_version_id = newVersion.id;
      }
      await adminClient.from("skills").update(updateData).eq("id", targetSkillId);

      await logAudit(adminClient, {
        action: skill_id ? "version_submitted" : "skill_submitted",
        skill_id: targetSkillId,
        version_id: newVersion.id,
        actor_id: user.id,
        metadata: {
          version,
          status: overallStatus,
          scan_failed: scanResult.scan_failed,
          layer1_critical: scanResult.layer1.critical_count,
          layer2_risk: scanResult.layer2.risk_level,
        },
      });

      return new Response(JSON.stringify({
        skill_id: targetSkillId,
        version_id: newVersion.id,
        version,
        status: overallStatus,
        scan_result: scanResult,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========================================
    // ACTION: update_metadata
    // ========================================
    if (action === "update_metadata") {
      const { skill_id, name, description, long_description, category, tags, trigger_pattern, icon_name } = body;

      if (!skill_id) {
        return new Response(JSON.stringify({ error: "skill_id is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: skill } = await adminClient
        .from("skills")
        .select("author_id, status")
        .eq("id", skill_id)
        .single();

      if (!skill || skill.author_id !== user.id) {
        return new Response(JSON.stringify({ error: "Skill not found or not owned by you" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!["draft", "rejected", "approved", "submitted"].includes(skill.status)) {
        return new Response(JSON.stringify({ error: "Cannot edit skill in current status" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const updateFields: any = {};
      if (name !== undefined) updateFields.name = name;
      if (description !== undefined) updateFields.description = description;
      if (long_description !== undefined) updateFields.long_description = long_description;
      if (category !== undefined) updateFields.category = category;
      if (tags !== undefined) updateFields.tags = tags;
      if (trigger_pattern !== undefined) updateFields.trigger_pattern = trigger_pattern;
      if (icon_name !== undefined) updateFields.icon_name = icon_name;

      await adminClient.from("skills").update(updateFields).eq("id", skill_id);

      await logAudit(adminClient, {
        action: "metadata_updated",
        skill_id,
        version_id: null,
        actor_id: user.id,
        metadata: { fields: Object.keys(updateFields) },
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========================================
    // ACTION: get_file_content (for downloads — approved only)
    // ========================================
    if (action === "get_file_content") {
      const { skill_id } = body;

      if (!skill_id) {
        return new Response(JSON.stringify({ error: "skill_id is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: skill } = await adminClient
        .from("skills")
        .select("current_version_id, status")
        .eq("id", skill_id)
        .single();

      if (!skill || skill.status !== "approved" || !skill.current_version_id) {
        return new Response(JSON.stringify({ error: "Skill not found or not approved" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: version } = await adminClient
        .from("skill_versions")
        .select("file_path")
        .eq("id", skill.current_version_id)
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
