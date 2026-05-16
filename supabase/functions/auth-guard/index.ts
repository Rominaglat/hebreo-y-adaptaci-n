// SEC-025 in-app mitigation — failed-login tracking + soft lockout.
//
// Frontend calls this BEFORE attempting login and AFTER a failed attempt.
// Best-effort defense in depth: a determined attacker can hit /auth/v1/token
// directly and bypass us. The real fix is CAPTCHA + WAF (operational, Step 6
// of the deploy runbook). This guards the common case: a user with a stolen
// password being brute-forced from a browser.
//
// Two actions, both unauthenticated:
//   - check:           returns { locked: bool }       given { email }
//   - record-failure:  returns { ok: true }           given { email }
//
// Rate-limited per IP (60/min) so the endpoint itself can't be used to flood.
// Closes SEC-025 (in-app side).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const jsonResp = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    if (req.method !== "POST") {
      return jsonResp({ error: "Method Not Allowed" }, 405);
    }

    const body = await req.json().catch(() => ({}));
    const action = String((body as { action?: string }).action ?? "");
    const email = String((body as { email?: string }).email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return jsonResp({ error: "invalid_email" }, 400);
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      req.headers.get("cf-connecting-ip") ??
      "unknown";

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // IP-based rate limit on the endpoint itself.
    const { data: rl } = await admin.rpc("check_and_increment_rate_limit", {
      p_key: `auth-guard:${ip}`,
      p_limit_per_minute: 60,
    });
    if (rl === false) {
      return jsonResp({ error: "rate_limit" }, 429);
    }

    if (action === "check") {
      const { data: locked } = await admin.rpc("is_login_locked", { p_email: email });
      return jsonResp({ locked: locked === true });
    }

    if (action === "record-failure") {
      await admin.rpc("record_failed_login", { p_email: email, p_ip: ip });
      return jsonResp({ ok: true });
    }

    return jsonResp({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("[auth-guard] error:", e);
    return jsonResp({ error: "internal_error" }, 500);
  }
});
