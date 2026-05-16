// Shared rate-limit helper, backed by the Postgres function
// `public.check_and_increment_rate_limit(key, limit_per_minute)`.
//
// Usage from an edge function:
//   const rl = await checkRateLimit(supabase, `ai-assistant:${user.id}`, 20);
//   if (!rl.allowed) {
//     return new Response(JSON.stringify({ error: 'rate_limit' }), {
//       status: 429,
//       headers: { ...corsHeaders, ...rl.headers, 'Content-Type': 'application/json' },
//     });
//   }
//
// Closes SEC-012.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface RateLimitResult {
  allowed: boolean;
  /** Headers to merge into the response (X-RateLimit-*, Retry-After when blocked). */
  headers: Record<string, string>;
}

/**
 * Check + increment a per-key per-minute counter. Atomic on the DB side.
 *
 * `key` should be unique per (function, user) — e.g. `ai-assistant:${user.id}`.
 * Use IP fallback (`ai-assistant:ip:1.2.3.4`) only when no user is present.
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  key: string,
  limitPerMinute: number,
): Promise<RateLimitResult> {
  // Safe fallback: if the helper fails (e.g. the migration hasn't been applied
  // yet), DO NOT fail open silently — log and refuse. The function will return
  // 503 to the caller until the migration lands.
  const { data, error } = await supabase.rpc("check_and_increment_rate_limit", {
    p_key: key,
    p_limit_per_minute: limitPerMinute,
  });

  if (error) {
    console.error("[rate-limit] RPC failure:", error.message);
    return {
      allowed: false,
      headers: {
        "X-RateLimit-Limit": String(limitPerMinute),
        "X-RateLimit-Remaining": "0",
        "Retry-After": "60",
      },
    };
  }

  const allowed = data === true;
  // We don't have the remaining count from the RPC; return a conservative
  // "limit - 1" when allowed, 0 when blocked. Callers that want precise
  // remaining counts can read rate_limit_buckets directly.
  return {
    allowed,
    headers: allowed
      ? {
          "X-RateLimit-Limit": String(limitPerMinute),
          "X-RateLimit-Remaining": String(Math.max(0, limitPerMinute - 1)),
        }
      : {
          "X-RateLimit-Limit": String(limitPerMinute),
          "X-RateLimit-Remaining": "0",
          "Retry-After": "60",
        },
  };
}
