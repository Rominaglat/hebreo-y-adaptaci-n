import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight } from "../_shared/cors.ts";

interface AuditEvent {
  id: string;
  user_id: string;
  activity_type: string;
  description: string;
  entity_type: string | null;
  entity_id: string | null;
  action: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

// SEC-011 — outbound SSRF guard for the user-configured webhook_url.
function isPrivateOrLoopbackHost(host: string): boolean {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
  }
  if (host.startsWith("[") && host.endsWith("]")) return true;
  const lower = host.toLowerCase();
  if (lower === "localhost") return true;
  if (lower === "metadata.google.internal") return true;
  if (lower.endsWith(".internal")) return true;
  if (lower.endsWith(".local")) return true;
  return false;
}

// SEC-045 — outbound webhook host allowlist.
// Default: only the configured Make.com endpoint. Override at runtime with
// AUDIT_WEBHOOK_ALLOWED_HOSTS=hook.eu2.make.com,hooks.example.io.
// Without this, a compromised admin could swap webhook_url to any public
// domain and exfiltrate audit events.
function loadAllowedWebhookHosts(): string[] {
  const env = Deno.env.get("AUDIT_WEBHOOK_ALLOWED_HOSTS") ?? "";
  const list = env.split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) {
    // Conservative default — known automation receivers only.
    return ["hook.eu2.make.com", "hook.make.com", "hooks.zapier.com"];
  }
  return list;
}

const ALLOWED_WEBHOOK_HOSTS = loadAllowedWebhookHosts();

function isAllowedWebhookHost(host: string): boolean {
  const lower = host.toLowerCase();
  return ALLOWED_WEBHOOK_HOSTS.some((allowed) => {
    if (allowed.startsWith(".")) return lower.endsWith(allowed);
    return lower === allowed || lower.endsWith("." + allowed);
  });
}

function validateOutboundUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null; // Only TLS endpoints
    if (isPrivateOrLoopbackHost(url.hostname)) return null;
    if (!isAllowedWebhookHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

// SEC-018 — constant-time comparison for shared-secret auth.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// SEC-019 — HMAC signature over the outbound body.
async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const bytes = new Uint8Array(sig);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendWebhook(
  webhookUrl: string,
  apiKey: string,
  signingSecret: string | null,
  event: AuditEvent,
  eventId: string,
  retryCount = 0,
): Promise<boolean> {
  const maxRetries = 3;
  const retryDelays = [0, 30000, 300000];

  try {
    console.log(`Sending webhook (attempt ${retryCount + 1}/${maxRetries})`);

    const body = JSON.stringify({
      event_id: eventId,
      timestamp: new Date().toISOString(),
      event_type: "audit_event",
      data: event,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      "X-Event-Type": "audit_event",
      "Idempotency-Key": eventId,
    };
    if (signingSecret) {
      headers["X-Signature"] = `sha256=${await hmacSha256Hex(signingSecret, body)}`;
    }

    const response = await fetch(webhookUrl, { method: "POST", headers, body });

    if (response.ok) {
      console.log(`Webhook sent OK`);
      return true;
    }

    console.error(`Webhook failed with status ${response.status}`);

    if (retryCount < maxRetries - 1) {
      const delay = retryDelays[retryCount + 1];
      console.log(`Retrying in ${delay / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return sendWebhook(webhookUrl, apiKey, signingSecret, event, eventId, retryCount + 1);
    }
    return false;
  } catch (error) {
    console.error(`Error sending webhook:`, error);
    if (retryCount < maxRetries - 1) {
      const delay = retryDelays[retryCount + 1];
      console.log(`Retrying in ${delay / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return sendWebhook(webhookUrl, apiKey, signingSecret, event, eventId, retryCount + 1);
    }
    return false;
  }
}

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // SEC-018 — dedicated secret instead of re-using the service-role key.
    // If unset, the only authorization path is the admin JWT below.
    const internalSecretEnv = Deno.env.get("AUDIT_WEBHOOK_INTERNAL_SECRET") ?? "";

    const authHeader = req.headers.get("Authorization");
    const internalSecret = req.headers.get("x-internal-secret") ?? "";

    let isAuthorized = false;

    // Option 1: Internal secret header (pg_net database triggers).
    if (
      internalSecretEnv.length > 0 &&
      internalSecret.length > 0 &&
      timingSafeEqual(internalSecret, internalSecretEnv)
    ) {
      isAuthorized = true;
      console.log("Authorized via dedicated internal secret");
    }

    // Option 2: Authenticated admin user.
    if (!isAuthorized && authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (!authError && user) {
        const { data: roleData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .single();
        if (roleData) {
          isAuthorized = true;
          console.log("Authorized via admin user:", user.id);
        }
      }
    }

    if (!isAuthorized) {
      console.error("Unauthorized access attempt to audit-webhook");
      return jsonResp({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: settings, error: settingsError } = await supabase
      .from("developer_settings")
      .select("*")
      .single();

    if (settingsError) {
      console.error("Error fetching developer settings:", settingsError);
      return jsonResp({ error: "Failed to fetch settings" }, 500);
    }

    if (!settings.webhook_enabled || !settings.webhook_url) {
      console.log("Webhook is disabled or URL not configured");
      return jsonResp({ message: "Webhook is disabled" }, 200);
    }

    // SEC-011 — refuse to send to private/loopback/internal hosts.
    const outboundUrl = validateOutboundUrl(settings.webhook_url);
    if (!outboundUrl) {
      console.error("Refusing to dispatch webhook to disallowed URL:", settings.webhook_url);
      return jsonResp({ error: "webhook_url is not allowed" }, 400);
    }

    const event: AuditEvent = await req.json();
    const eventId = (event as any).id || crypto.randomUUID();
    const signingSecret = (settings as any).webhook_signing_secret ?? null;
    if (!signingSecret) {
      console.warn(
        "[audit-webhook] webhook_signing_secret is not set — outbound dispatch will be unsigned. " +
          "Receivers should reject unsigned events once this is rolled out.",
      );
    }

    const success = await sendWebhook(
      outboundUrl.toString(),
      settings.api_key,
      signingSecret,
      event,
      eventId,
    );

    return jsonResp(
      {
        success,
        message: success ? "Webhook sent successfully" : "Failed to send webhook after retries",
      },
      success ? 200 : 502,
    );
  } catch (error) {
    console.error("Error in audit-webhook function:", error);
    // Do not leak internal error details to the caller.
    return jsonResp({ error: "Internal server error" }, 500);
  }
});
