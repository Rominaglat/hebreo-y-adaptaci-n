// kg-recommend — concept-based course recommendations.
//
// Pipeline:
//   1. Auth user via Supabase JWT
//   2. Fetch the user's enrollments (status: started or completed) from Supabase
//   3. Call kg-api /v1/t/{tid}/recommend/courses with those courses as seeds
//      and the same enrollment list as exclusions
//   4. Return ranked recommendations with full course metadata
//
// If the user has no enrollments yet, kg-api falls back to "most varied
// content" — courses that cover the largest set of concepts.
//
// Required Supabase secrets:
//   KG_API_URL, KG_API_TOKEN, SUPABASE_URL, SUPABASE_ANON_KEY,
//   SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight } from "../_shared/cors.ts";


const KG_API_URL = Deno.env.get("KG_API_URL")!;
const KG_API_TOKEN = Deno.env.get("KG_API_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Single-tenant: every KG resource lives under this constant namespace.
const SINGLE_TENANT_ID = "00000000-0000-0000-0000-000000000000";

interface RecommendedCourse {
  course_id: string;
  course_title: string;
  description: string | null;
  thumbnail_url: string | null;
  shared_concepts: number;
  total_mentions: number;
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // tenant_id accepted from body for back-compat but is ignored
    // (single-tenant — kg-api is keyed by the constant SINGLE_TENANT_ID).
    const { limit = 5 } = await req.json().catch(() => ({}));
    const tenant_id = SINGLE_TENANT_ID;

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const token = authHeader.slice(7);
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Defense in depth: verify the user has been provisioned (has a role row).
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the user's enrollments (any progress > 0 → seed)
    const { data: enrollments } = await supabase
      .from("enrollments")
      .select("course_id, progress_percentage")
      .eq("user_id", user.id);

    const seedCourseIds = (enrollments ?? [])
      .filter((e) => (e.progress_percentage ?? 0) > 0)
      .map((e) => e.course_id as string);
    const allEnrolledIds = (enrollments ?? []).map((e) => e.course_id as string);

    // Call kg-api
    const kgResp = await fetch(`${KG_API_URL}/v1/t/${tenant_id}/recommend/courses`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${KG_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        seed_course_ids: seedCourseIds,
        // Exclude EVERYTHING the user is already enrolled in (started or not),
        // so recommendations are always something new.
        exclude_course_ids: allEnrolledIds,
        limit: Math.min(Math.max(Number(limit) || 5, 1), 20),
      }),
    });

    if (!kgResp.ok) {
      // 404 = tenant not provisioned in KG. Return empty so the frontend can fall back.
      if (kgResp.status === 404) {
        return new Response(
          JSON.stringify({ recommendations: [], reason: "kg_not_provisioned" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const errText = await kgResp.text();
      console.error("kg-api recommend error:", kgResp.status, errText);
      return new Response(
        JSON.stringify({ error: `kg-api ${kgResp.status}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await kgResp.json();
    const rows = (data.rows ?? []) as RecommendedCourse[];

    // Hydrate against Supabase to filter to PUBLISHED courses only
    // (KG may contain unpublished courses too)
    if (rows.length > 0) {
      const ids = rows.map((r) => r.course_id);
      const { data: published } = await supabase
        .from("courses")
        .select("id, is_published")
        .in("id", ids)
        .eq("is_published", true);
      const publishedIds = new Set((published ?? []).map((p) => p.id));
      const filtered = rows.filter((r) => publishedIds.has(r.course_id));

      return new Response(
        JSON.stringify({
          recommendations: filtered,
          seeded_from: seedCourseIds.length,
          source: seedCourseIds.length > 0 ? "concept_overlap" : "popular",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ recommendations: [], seeded_from: seedCourseIds.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("kg-recommend error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
