// kg-query — natural-language query over the knowledge graph.
//
// Embeds the user's question with Gemini (RETRIEVAL_QUERY task) and forwards
// the embedding to kg-api /v1/t/{tenant_id}/query for hybrid retrieval
// (vector search on lessons + graph expansion via shared concepts).
//
// This endpoint is the foundation of the future AI assistant cutover. For now
// it returns raw hits — generation (LLM answer with citations) will be added
// later or done client-side.
//
// Auth: signed-in user via Supabase JWT. Single-tenant build — every
// authenticated user has access to the one tenant's KG namespace.
//
// Request body: { query: string, k?: number, expand?: boolean }
// Response:     { hits: [...], query: string, embedding_dim: number }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight } from "../_shared/cors.ts";


const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const KG_API_URL = Deno.env.get("KG_API_URL")!;
const KG_API_TOKEN = Deno.env.get("KG_API_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Single-tenant: every KG resource lives under this constant namespace,
// matching the value baked into the frontend (src/constants/singleTenant.ts).
const SINGLE_TENANT_ID = "00000000-0000-0000-0000-000000000000";

const EMBED_MODEL = "gemini-embedding-001";
const OUTPUT_DIM = 1024;

async function embedQuery(text: string): Promise<number[]> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GEMINI_API_KEY}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text }] },
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: OUTPUT_DIM,
    }),
  });
  if (!resp.ok) {
    throw new Error(`gemini ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const data = await resp.json();
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || values.length !== OUTPUT_DIM) {
    throw new Error(`gemini returned bad embedding`);
  }
  return values;
}

// Single-tenant: every authenticated user shares the same KG namespace.
function getTenantId(): string {
  return SINGLE_TENANT_ID;
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  // Auth: read user from JWT (deployed with --no-verify-jwt so we validate ourselves)
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "missing token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userJwt = auth.slice("Bearer ".length);

  const supabaseAuth = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  });
  const { data: userData, error: userErr } = await supabaseAuth.auth.getUser(userJwt);
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "invalid token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { query: string; k?: number; expand?: boolean; tenant_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body.query?.trim()) {
    return new Response(JSON.stringify({ error: "query required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const tenantId = getTenantId();

    // Defense in depth: verify the caller actually has a role row in user_roles
    // (i.e. has been provisioned in this single-tenant app).
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .limit(1)
      .maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const embedding = await embedQuery(body.query);

    const kgResp = await fetch(`${KG_API_URL}/v1/t/${tenantId}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${KG_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query_embedding: embedding,
        k: body.k ?? 10,
        expand_via_concepts: body.expand ?? true,
      }),
    });
    if (!kgResp.ok) {
      throw new Error(`kg-api query ${kgResp.status}: ${(await kgResp.text()).slice(0, 200)}`);
    }
    const result = await kgResp.json();

    return new Response(
      JSON.stringify({
        query: body.query,
        tenant_id: tenantId,
        embedding_dim: embedding.length,
        hits: result.hits ?? [],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("kg-query error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
