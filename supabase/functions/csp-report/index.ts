// SEC-006 follow-up — CSP report-uri endpoint.
//
// Browsers POST a JSON body when a directive is violated (or hypothetically
// would be violated, under -Report-Only). We persist the most useful fields
// to `public.csp_violations` so you can review them and tighten the policy.
//
// Public (no auth) — browsers cannot send the user's Authorization header.
// We rate-limit per (IP, blocked-uri) to prevent spam.
//
// Wire from vercel.json CSP: `report-uri https://your-project-ref.supabase.co/functions/v1/csp-report`.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

interface CspReportPayload {
  "csp-report"?: {
    "document-uri"?: string;
    referrer?: string;
    "violated-directive"?: string;
    "effective-directive"?: string;
    "original-policy"?: string;
    disposition?: string;
    "blocked-uri"?: string;
    "line-number"?: number;
    "column-number"?: number;
    "source-file"?: string;
    "status-code"?: number;
    "script-sample"?: string;
  };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  try {
    // Browsers may send `application/csp-report` or `application/reports+json`.
    // Be tolerant.
    const raw = await req.text();
    let body: CspReportPayload | unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    const r = (body as CspReportPayload)["csp-report"];
    if (!r) {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? null;
    const ua = req.headers.get("user-agent") ?? null;

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // Per-(ip, directive, blocked-uri) per-minute rate limit to prevent log flood.
    const rlKey = `csp:${ip ?? "anon"}:${r["effective-directive"] ?? ""}:${r["blocked-uri"] ?? ""}`;
    const { data: rl } = await admin.rpc("check_and_increment_rate_limit", {
      p_key: rlKey,
      p_limit_per_minute: 5,
    });
    if (rl === false) {
      // Silently swallow further reports this minute.
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    await admin.from("csp_violations").insert({
      document_uri: r["document-uri"] ?? null,
      referrer: r.referrer ?? null,
      directive: r["effective-directive"] ?? r["violated-directive"] ?? null,
      blocked_uri: r["blocked-uri"] ?? null,
      source_file: r["source-file"] ?? null,
      line_number: r["line-number"] ?? null,
      column_number: r["column-number"] ?? null,
      script_sample: (r["script-sample"] ?? null)?.slice(0, 1024) ?? null,
      disposition: r.disposition ?? null,
      user_agent: ua,
      ip_address: ip,
    });

    return new Response(null, { status: 204, headers: corsHeaders });
  } catch (e) {
    console.error("[csp-report] error:", e);
    // Always 204 so the browser doesn't retry — silent drop is fine here.
    return new Response(null, { status: 204, headers: corsHeaders });
  }
});
