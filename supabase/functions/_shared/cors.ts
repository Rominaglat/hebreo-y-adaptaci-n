// Shared CORS helper for all edge functions.
//
// Replaces the old `Access-Control-Allow-Origin: *` pattern with an origin allowlist.
// Callers from un-allowlisted origins receive a response with NO ACAO header at all —
// the browser then refuses the cross-origin request. Server-to-server callers (no Origin
// header) are unaffected because they don't need CORS.
//
// Customize ALLOWED_ORIGINS by setting the `ALLOWED_ORIGINS` env var to a comma-separated
// list. If unset, defaults to the production + localhost dev origins below.
//
// Closes SEC-007.

const DEFAULT_ALLOWED_ORIGINS = [
  // Hebreo y Adaptación production custom domain (Vercel).
  "https://app.rominahebreo.com",
  "https://rominahebreo.com",
  "https://www.rominahebreo.com",
  // Local dev — Vite default port is 8080 per vite.config.ts; 5173 is the
  // upstream default and accepted for parity.
  "http://localhost:5173",
  "http://localhost:8080",
];

// Vercel preview deployments use the pattern `<slug>-<owner>.vercel.app`.
// Allow any *.vercel.app to support PR previews. Tighten this for stricter production.
const ALLOWED_ORIGIN_PATTERNS: RegExp[] = [
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/i,
];

function loadAllowedOrigins(): string[] {
  const envList = Deno.env.get("ALLOWED_ORIGINS");
  if (envList) {
    return envList.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return DEFAULT_ALLOWED_ORIGINS;
}

const ALLOWED_ORIGINS = loadAllowedOrigins();

function isAllowedOrigin(origin: string | null): origin is string {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
}

/**
 * Build the CORS response headers for a request.
 * Returns ACAO only when the request's Origin is allowlisted.
 * Always echoes the request's Access-Control-Request-Headers (subject to a sensible default).
 *
 * Set `allowCredentials: true` ONLY on endpoints that intentionally
 * accept/return cookies (e.g. the auth-cookie function for SEC-017). When
 * credentials are allowed, ACAO must be the exact origin (never *).
 */
export function getCorsHeaders(
  req: Request,
  options: { allowCredentials?: boolean } = {},
): Record<string, string> {
  const origin = req.headers.get("Origin");
  const headers: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      req.headers.get("Access-Control-Request-Headers") ??
      "authorization, x-client-info, apikey, content-type, x-internal-secret, x-signature, idempotency-key, x-webhook-secret",
    "Access-Control-Max-Age": "86400",
  };
  if (isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    if (options.allowCredentials) {
      headers["Access-Control-Allow-Credentials"] = "true";
    }
  }
  return headers;
}

/**
 * Return a 204 No Content response for OPTIONS preflight, with the appropriate CORS headers.
 * Returns null for non-OPTIONS requests so the handler can continue.
 */
export function handlePreflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: getCorsHeaders(req) });
}

/**
 * Convenience JSON response that always emits the CORS headers for the request.
 */
export function corsJson(req: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...getCorsHeaders(req),
      "Content-Type": "application/json",
    },
  });
}
