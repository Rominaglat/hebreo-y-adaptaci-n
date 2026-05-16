import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.5.0";
import { getCorsHeaders, handlePreflight } from "../_shared/cors.ts";


interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tenantId?: string;
  userId?: string;
  icon?: string;
}

type WebPushResult = {
  ok: boolean;
  expired: boolean;
  status?: number;
  error?: string;
  endpoint?: string;
};

function base64UrlToUint8Array(input: string): Uint8Array {
  const padding = "=".repeat((4 - (input.length % 4)) % 4);
  const base64 = (input + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) output[i] = rawData.charCodeAt(i);
  return output;
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildVapidJwks(vapidPublicKey: string, vapidPrivateKey: string): {
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
} {
  const pubBytes = base64UrlToUint8Array(vapidPublicKey.trim());
  if (pubBytes.length !== 65 || pubBytes[0] !== 4) {
    throw new Error("Invalid VAPID public key format (expected uncompressed P-256 key)");
  }

  const x = uint8ArrayToBase64Url(pubBytes.slice(1, 33));
  const y = uint8ArrayToBase64Url(pubBytes.slice(33, 65));

  const trimmedPriv = vapidPrivateKey.trim();
  if (trimmedPriv.startsWith("{")) {
    const parsed = JSON.parse(trimmedPriv);
    if (parsed?.kty === "EC" && parsed?.crv === "P-256" && parsed?.d) {
      const pub: JsonWebKey = { kty: "EC", crv: "P-256", alg: "ES256", x, y, ext: true };
      const priv: JsonWebKey = { ...pub, d: parsed.d, key_ops: ["sign"] };
      return { publicJwk: pub, privateJwk: priv };
    }
  }

  const dBytes = base64UrlToUint8Array(trimmedPriv);
  if (dBytes.length !== 32) {
    throw new Error("Invalid VAPID private key format (expected 32-byte base64url 'd')");
  }
  const d = uint8ArrayToBase64Url(dBytes);

  const publicJwk: JsonWebKey = { kty: "EC", crv: "P-256", alg: "ES256", x, y, ext: true, key_ops: ["verify"] };
  const privateJwk: JsonWebKey = { kty: "EC", crv: "P-256", alg: "ES256", x, y, d, ext: false, key_ops: ["sign"] };
  return { publicJwk, privateJwk };
}

async function importVapidKeysFromSecrets(vapidPublicKey: string, vapidPrivateKey: string): Promise<CryptoKeyPair> {
  const { publicJwk, privateJwk } = buildVapidJwks(vapidPublicKey, vapidPrivateKey);

  const algo = { name: "ECDSA", namedCurve: "P-256" } as const;
  const publicKey = await crypto.subtle.importKey("jwk", publicJwk, algo, true, ["verify"]);
  const privateKey = await crypto.subtle.importKey("jwk", privateJwk, algo, false, ["sign"]);
  return { publicKey, privateKey };
}

// Detect push service type from endpoint
function getPushServiceType(endpoint: string): string {
  if (endpoint.includes("fcm.googleapis.com") || endpoint.includes("firebase")) {
    return "FCM (Android/Chrome)";
  } else if (endpoint.includes("push.apple.com")) {
    return "APNs (iOS/Safari)";
  } else if (endpoint.includes("mozilla.com") || endpoint.includes("mozilla.org")) {
    return "Mozilla (Firefox)";
  } else if (endpoint.includes("windows.com") || endpoint.includes("notify.windows.com")) {
    return "WNS (Windows/Edge)";
  }
  return "Unknown";
}

async function sendToSubscription(
  appServer: webpush.ApplicationServer,
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
): Promise<WebPushResult> {
  const serviceType = getPushServiceType(subscription.endpoint);
  console.log(`[push] Sending to ${serviceType}: ${subscription.endpoint.substring(0, 60)}...`);

  try {
    const subscriber = appServer.subscribe({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    });

    await subscriber.pushTextMessage(JSON.stringify(payload), {
      urgency: webpush.Urgency.High,
      ttl: 86400,
    });

    console.log(`[push] SUCCESS for ${serviceType}`);
    return { ok: true, expired: false, endpoint: subscription.endpoint };
  } catch (err: any) {
    if (err instanceof webpush.PushMessageError) {
      const status = err.response?.status;
      const errorText = await err.response?.text().catch(() => err.toString());
      const expired = status === 404 || status === 410;
      console.error(`[push] FAILED for ${serviceType}: status=${status}, expired=${expired}, error=${errorText}`);
      return { ok: false, expired, status, error: errorText, endpoint: subscription.endpoint };
    }

    const msg = err?.message ?? String(err);
    console.error(`[push] FAILED for ${serviceType}: ${msg}`);
    return { ok: false, expired: false, error: msg, endpoint: subscription.endpoint };
  }
}


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  function jsonResponse(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");

    if (!vapidPublicKey || !vapidPrivateKey) {
      console.error("VAPID keys not configured");
      return jsonResponse({ error: "VAPID keys not configured" }, 500);
    }

    // ── Authentication ────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const payload: PushPayload = await req.json();

    if (!payload?.title || !payload?.body) {
      return jsonResponse({ error: "title and body are required" }, 400);
    }

    // ── Authorization: caller must have a role in user_roles ──────
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: callerRoles } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    if (!callerRoles || callerRoles.length === 0) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    const callerIsAdmin = callerRoles.some(
      (r) => r.role === "admin" || r.role === "super_admin",
    );

    // Non-admin callers may only push to themselves.
    if (!callerIsAdmin) {
      if (!payload.userId || payload.userId !== user.id) {
        return jsonResponse({ error: "Forbidden" }, 403);
      }
    } else if (payload.userId) {
      // Admins may target a specific user — verify the target exists in user_roles.
      const { data: targetRole } = await adminClient
        .from("user_roles")
        .select("id")
        .eq("user_id", payload.userId)
        .limit(1)
        .maybeSingle();
      if (!targetRole) {
        return jsonResponse({ error: "Target user not found" }, 403);
      }
    }

    console.log("[push] Authorized:", JSON.stringify({
      caller: user.id,
      callerIsAdmin,
      targetUserId: payload.userId ?? "<broadcast>",
    }));

    // ── Build subscription query (single-tenant — no tenant filter) ──
    let query = adminClient.from("push_subscriptions").select("*");

    if (payload.userId) {
      query = query.eq("user_id", payload.userId);
    }

    const { data: subscriptions, error: fetchError } = await query;

    if (fetchError) {
      console.error("[push] Error fetching subscriptions:", fetchError);
      return new Response(JSON.stringify({ error: "Failed to fetch subscriptions" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[push] Found ${subscriptions?.length || 0} subscriptions`);

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ message: "No subscriptions found", sent: 0, failed: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log subscription details
    subscriptions.forEach((sub, i) => {
      const serviceType = getPushServiceType(sub.endpoint);
      console.log(`[push] Subscription ${i + 1}: ${serviceType} for user ${sub.user_id}`);
    });

    // Build an RFC8291-compliant application server (aes128gcm)
    const contact = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
    const vapidKeys = await importVapidKeysFromSecrets(vapidPublicKey, vapidPrivateKey);
    const appServer = await webpush.ApplicationServer.new({
      contactInformation: contact,
      vapidKeys,
    });

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        const result = await sendToSubscription(
          appServer,
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          payload,
        );

        // Remove ONLY expired subscriptions
        if (result.expired) {
          console.log(`[push] Removing expired subscription: ${sub.id}`);
          await adminClient.from("push_subscriptions").delete().eq("id", sub.id);
        }

        return result;
      }),
    );

    const sent = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
    const failed = results.length - sent;

    // Log detailed results
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        const v = r.value;
        console.log(`[push] Result ${i + 1}: ok=${v.ok}, expired=${v.expired}, status=${v.status || 'N/A'}, error=${v.error || 'none'}`);
      } else {
        console.log(`[push] Result ${i + 1}: REJECTED - ${r.reason}`);
      }
    });

    console.log(`[push] Final: sent=${sent}, failed=${failed}`);

    return new Response(JSON.stringify({ message: "Push notifications sent", sent, failed }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[push] Error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});