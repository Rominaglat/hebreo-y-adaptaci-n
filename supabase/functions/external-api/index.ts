import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight } from "../_shared/cors.ts";
import { MATCH_DIGITS_MIN, isMatchableInput, matchPhone, matchQueryVariants } from "../_shared/phone-match.ts";
import { contactEmailKey, contactPhoneKey } from "../_shared/contact-suppression.ts";


interface ApiRequest {
  action: string;
  data?: Record<string, any>;
}

interface DeveloperSettings {
  api_key: string;
  rate_limit_per_minute: number;
  rate_limit_enabled: boolean;
}

// Hash API key for storage (don't store raw key in logs)
function hashApiKey(apiKey: string): string {
  if (apiKey.length > 12) {
    return `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
  }
  return apiKey.slice(0, 4) + '...';
}

// Keys whose VALUES must never reach api_request_logs. The log exists to answer
// "who called what, when, and did it work" — it never needs the customer's
// phone number to do that, and users.inactivityByPhone is keyed on exactly that
// number, so every single call would otherwise persist one.
const REDACTED_LOG_KEYS = new Set(['password', 'phone', 'email']);

// The ONLY actions still allowed to log those values, and the only reason they
// are on the list is that they already do: `users.create` writes the caller's
// plaintext `password` and the customer's `phone` into api_request_logs today
// (98 historical rows hold them), `users.updatePassword` writes the password and
// `users.search` writes the phone fragment it searched on. Redacting them would
// be an improvement, but it would also change what an existing, in-use action
// logs, so it is left as a separate, larger cleanup — one that has to scrub the
// historical rows too, which no code change can do.
//
// EVERYTHING ELSE FAILS CLOSED. The gate used to be the other way round — an
// allow-list of actions to redact — which meant a caller typo ('users.inactivitybyphone'),
// an older action name, or simply calling before this function is redeployed
// would sail past the switch into `default:` and persist the customer's real
// phone number. An exempt-list cannot fail that way: an unrecognised action is
// redacted.
const UNREDACTED_LEGACY_ACTIONS = new Set(['users.create', 'users.search', 'users.updatePassword']);

function redactForLog(action: string, data: any): any {
  if (UNREDACTED_LEGACY_ACTIONS.has(action)) return data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    // Case-insensitive: a caller sending 'Phone' would not be read by any
    // handler, but the raw value would still land in the log.
    out[k] = REDACTED_LOG_KEYS.has(k.toLowerCase()) ? '[redacted]' : v;
  }
  return out;
}

// Log API request
async function logRequest(
  supabase: any,
  apiKeyHash: string,
  action: string,
  statusCode: number,
  responseTimeMs: number,
  errorMessage: string | null,
  requestData: any,
  ipAddress: string | null,
  userAgent: string | null
) {
  try {
    const { error } = await supabase.from('api_request_logs').insert({
      api_key_hash: apiKeyHash,
      action,
      status_code: statusCode,
      response_time_ms: responseTimeMs,
      error_message: errorMessage,
      request_data: requestData ? JSON.stringify(requestData).slice(0, 1000) : null,
      ip_address: ipAddress,
      user_agent: userAgent
    });
    if (error) {
      console.error('Failed to log API request:', error);
    }
  } catch (error) {
    console.error('Failed to log API request:', error);
  }
}

// Check rate limit
async function checkRateLimit(
  supabase: any,
  apiKeyHash: string,
  limitPerMinute: number
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from('api_request_logs')
    .select('id', { count: 'exact', head: true })
    .eq('api_key_hash', apiKeyHash)
    .gte('created_at', oneMinuteAgo);

  if (error) {
    console.error('Rate limit check error:', error);
    return { allowed: true, remaining: limitPerMinute, resetAt: new Date(Date.now() + 60000) };
  }

  const requestCount = count || 0;
  const remaining = Math.max(0, limitPerMinute - requestCount);
  const resetAt = new Date(Date.now() + 60000);

  return {
    allowed: requestCount < limitPerMinute,
    remaining,
    resetAt
  };
}


// Single-tenant build: no per-row ownership checks against a tenant_id are
// needed — every resource belongs to the one tenant. Existence checks remain
// where they protect against bad IDs from the caller.

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  function jsonResponse(data: any, status = 200) {
    return new Response(
      JSON.stringify(data),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  function errorResponse(message: string, code: string, status = 400) {
    return new Response(
      JSON.stringify({ error: message, code }),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  const startTime = Date.now();

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Get request metadata for logging
  const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || null;
  const userAgent = req.headers.get('user-agent');

  let apiKeyHash = 'unknown';
  let action = 'unknown';
  let requestData: any = null;

  // Helper to send response with logging
  async function sendResponse(response: Response, errorMsg: string | null = null) {
    const responseTime = Date.now() - startTime;
    await logRequest(supabase, apiKeyHash, action, response.status, responseTime, errorMsg, requestData, ipAddress, userAgent);
    return response;
  }

  try {
    // Validate API key
    const apiKey = req.headers.get('X-API-Key');
    if (!apiKey) {
      // Deliberately NOT through sendResponse: a request with no key at all
      // carries nothing worth auditing (the hash is 'unknown' and the body has
      // not been read yet), and logging it hands any anonymous host on the
      // internet a free INSERT into api_request_logs, one row per request, with
      // no rate limit in front of it. An *invalid* key below is still logged —
      // that one names a hash and is a real security signal.
      console.warn(`[API] Missing API key from ${ipAddress}`);
      return jsonResponse({ error: 'Missing API key', code: 'UNAUTHORIZED' }, 401);
    }

    apiKeyHash = hashApiKey(apiKey);

    // Single-tenant: the API key the admin generates in PlatformSettings
    // lands in tenant_settings.api_key (via the DeveloperSettings component).
    // The legacy developer_settings table is unused and sits empty, so a
    // lookup there was always returning null and 401'ing every caller.
    // We check tenant_settings first; developer_settings stays as a
    // back-compat fallback in case anyone still writes there.
    let isValidKey = false;
    let rateLimitEnabled = false;
    let rateLimitPerMinute = 60;

    const { data: tenantSettings } = await supabase
      .from('tenant_settings')
      .select('api_key')
      .limit(1)
      .maybeSingle();

    if (tenantSettings && tenantSettings.api_key === apiKey) {
      isValidKey = true;
      // tenant_settings has no rate-limit columns, so the throttle that the
      // developer_settings branch below reads from the database is applied here
      // at the file's own default. Without this, rateLimitEnabled stayed false
      // for the only branch this deployment ever takes and checkRateLimit was
      // dead code — every caller was unthrottled. The busiest rolling 60s window
      // in the entire api_request_logs history is 4 calls, so 60 leaves 15x
      // headroom; raise it here if a bulk import ever needs more.
      rateLimitEnabled = true;
      rateLimitPerMinute = 60;
    } else {
      // Legacy path — read from developer_settings if someone populates it.
      const { data: devSettings } = await supabase
        .from('developer_settings')
        .select('api_key, rate_limit_per_minute, rate_limit_enabled')
        .maybeSingle();
      if (devSettings && devSettings.api_key === apiKey) {
        isValidKey = true;
        rateLimitEnabled = devSettings.rate_limit_enabled || false;
        rateLimitPerMinute = devSettings.rate_limit_per_minute || 60;
      }
    }

    if (!isValidKey) {
      // hashApiKey keeps only the key's first 8 and last 4 characters, so a
      // wrong key can share the real key's hash. checkRateLimit counts log rows
      // by hash: logging a failed attempt under the bare hash would let anyone
      // who knows those 12 characters burn the real caller's per-minute budget.
      // Failed attempts get their own bucket.
      apiKeyHash = `invalid:${apiKeyHash}`;
      console.warn(`[API] Invalid API key attempt: ${apiKeyHash} from ${ipAddress}`);
      return await sendResponse(
        jsonResponse({ error: 'Invalid API key', code: 'UNAUTHORIZED' }, 401),
        'Invalid API key'
      );
    }

    // Check rate limit
    if (rateLimitEnabled) {
      const rateLimit = await checkRateLimit(supabase, apiKeyHash, rateLimitPerMinute);

      if (!rateLimit.allowed) {
        console.warn(`[API] Rate limit exceeded for ${apiKeyHash}`);
        return await sendResponse(
          new Response(
            JSON.stringify({
              error: 'Rate limit exceeded',
              code: 'RATE_LIMITED',
              retry_after: Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1000)
            }),
            {
              status: 429,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
                'X-RateLimit-Limit': String(rateLimitPerMinute),
                'X-RateLimit-Remaining': '0',
                'X-RateLimit-Reset': String(Math.floor(rateLimit.resetAt.getTime() / 1000)),
                'Retry-After': String(Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1000))
              }
            }
          ),
          'Rate limit exceeded'
        );
      }
    }

    // Parse request body
    const body: ApiRequest = await req.json();
    action = body.action || 'unknown';
    // Logging-only. `data` below is the untouched body, so no handler ever sees
    // a redacted value — see UNREDACTED_LEGACY_ACTIONS.
    requestData = redactForLog(action, body.data);
    const data = body.data;

    console.log(`[API] Request: ${action} from ${apiKeyHash} (${ipAddress})`);

    // Route to appropriate handler
    switch (action) {
      // ===== USERS =====
      case 'users.list': {
        const { data: users, error } = await supabase
          .from('profiles')
          .select('id, email, full_name, avatar_url, join_date, created_at')
          .order('created_at', { ascending: false })
          .limit(data?.limit || 100);

        if (error) throw error;
        return await sendResponse(jsonResponse({ users }));
      }

      case 'users.get': {
        if (!data?.user_id) {
          return await sendResponse(errorResponse('user_id is required', 'VALIDATION_ERROR'), 'user_id is required');
        }

        const { data: user, error } = await supabase
          .from('profiles')
          .select('id, email, full_name, avatar_url, bio, join_date, created_at')
          .eq('id', data.user_id)
          .single();

        if (error) throw error;
        return await sendResponse(jsonResponse({ user }));
      }

      case 'users.getRoles': {
        if (!data?.user_id) {
          return await sendResponse(errorResponse('user_id is required', 'VALIDATION_ERROR'), 'user_id is required');
        }

        const { data: roles, error } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', data.user_id);

        if (error) throw error;
        return await sendResponse(jsonResponse({ roles: roles.map(r => r.role) }));
      }

      case 'users.setRole': {
        if (!data?.user_id || !data?.role) {
          return await sendResponse(errorResponse('user_id and role are required', 'VALIDATION_ERROR'), 'user_id and role are required');
        }
        const validRoles = ['admin', 'instructor', 'student'];
        if (!validRoles.includes(data.role)) {
          return await sendResponse(errorResponse(`Invalid role. Must be one of: ${validRoles.join(', ')}`, 'VALIDATION_ERROR'), 'Invalid role');
        }

        const { error: deleteError } = await supabase
          .from('user_roles')
          .delete()
          .eq('user_id', data.user_id);

        if (deleteError) throw deleteError;

        const { error: insertError } = await supabase
          .from('user_roles')
          .insert({ user_id: data.user_id, role: data.role });

        if (insertError) throw insertError;
        return await sendResponse(jsonResponse({ success: true, message: `Role set to ${data.role}` }));
      }

      case 'users.create': {
        if (!data?.email || !data?.password) {
          return await sendResponse(errorResponse('email and password are required', 'VALIDATION_ERROR'), 'email and password are required');
        }
        if (data.password.length < 6) {
          return await sendResponse(errorResponse('Password must be at least 6 characters', 'VALIDATION_ERROR'), 'Password too short');
        }

        // Validate access_hours up front so we never half-apply then reject.
        // null = not provided in the request.
        let accessHours: number | null = null;
        if (data.access_hours !== undefined && data.access_hours !== null && data.access_hours !== '') {
          accessHours = Number(data.access_hours);
          if (!Number.isFinite(accessHours) || accessHours < 0) {
            return await sendResponse(
              errorResponse('access_hours must be a non-negative number', 'VALIDATION_ERROR'),
              'Invalid access_hours',
            );
          }
        }

        const email = String(data.email).trim().toLowerCase();
        const fullName = data.full_name || data.name || email;
        const allowedRoles = ['admin', 'instructor', 'student', 'lead'];
        const resolvedRole = data.role && allowedRoles.includes(data.role) ? data.role : 'student';

        // Create — but if the email already exists, fall back to UPDATE instead
        // of failing with 409. The payment automation re-sends a lead who paid;
        // we overwrite their role, content access, personal details and time
        // limit (desired-state), leaving the password and (for staff) the
        // role/limit untouched.
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
          email,
          password: data.password,
          email_confirm: true,
          user_metadata: { full_name: fullName },
        });

        let userId: string;
        let isUpdate = false;
        if (authError) {
          // Detect "email already registered" robustly — don't depend on one
          // English phrasing. GoTrue uses status 422 / code 'email_exists' and
          // various messages ("already registered", "already been registered").
          const msg = (authError.message || '').toLowerCase();
          const isDuplicate =
            msg.includes('already') || msg.includes('registered') || msg.includes('exists') ||
            (authError as { status?: number }).status === 422 ||
            (authError as { code?: string }).code === 'email_exists';
          if (!isDuplicate) {
            throw authError;
          }
          // Existing user → look them up by email to recover their id.
          // CRITICAL: GoTrue's `?email=` admin filter is unreliable — it
          // returns the first user of the UNFILTERED list, not the match.
          // Taking users[0] here would recover onto a DIFFERENT account and
          // then overwrite its profile/role/enrollments below, silently
          // hijacking another user. Page through and require an exact,
          // case-insensitive email match; abort if none is found.
          isUpdate = true;
          const wanted = email.toLowerCase();
          let existing: { id: string; email?: string } | undefined;
          for (let page = 1; page <= 20 && !existing; page++) {
            const lookupRes = await fetch(
              `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=200`,
              { headers: { Authorization: `Bearer ${supabaseServiceKey}`, apikey: supabaseServiceKey } },
            );
            const lookupData = await lookupRes.json();
            const users: Array<{ id: string; email?: string }> = Array.isArray(lookupData?.users) ? lookupData.users : [];
            if (users.length === 0) break;
            existing = users.find((u) => (u?.email ?? '').toLowerCase() === wanted);
          }
          if (!existing?.id) {
            return await sendResponse(
              errorResponse('User already exists but could not be located for update', 'CONFLICT', 409),
              'Existing user lookup failed',
            );
          }
          userId = existing.id;
        } else {
          userId = authData.user.id;
        }

        // Never let the API demote or time-limit a staff account that already
        // exists. Staff still get their profile + enrollments updated.
        let isPrivileged = false;
        if (isUpdate) {
          const { data: existingRoles } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', userId);
          isPrivileged = (existingRoles || []).some(
            (r) => r.role === 'admin' || r.role === 'super_admin' || r.role === 'instructor',
          );
        }

        // 1) Personal details — overwrite (both paths). Upsert because
        // admin.createUser does NOT reliably fire the public.profiles trigger.
        const { error: profileError } = await supabase.from('profiles').upsert({
          id: userId,
          email,
          full_name: fullName,
          phone: data.phone || null,
        });
        if (profileError) {
          console.error(`[API users.create] profile upsert failed (${isUpdate ? 'update' : 'create'}):`, profileError);
        }

        // 2) Role — overwrite to the requested role (default student), unless
        // the existing account is staff (guard: a webhook must not demote an admin).
        if (!isPrivileged) {
          const { error: roleDelErr } = await supabase.from('user_roles').delete().eq('user_id', userId);
          if (roleDelErr) console.error('[API users.create] user_roles delete failed:', roleDelErr);
          const { error: roleInsErr } = await supabase.from('user_roles').insert({ user_id: userId, role: resolvedRole });
          if (roleInsErr) console.error('[API users.create] user_roles insert failed:', roleInsErr);
        }

        // 3) Content access — when `courses` is a valid spec (an array of ids
        // or 'all'), REPLACE the user's enrollments with exactly that set
        // (drop existing, then insert). Anything else (absent/null/'' /invalid)
        // → leave enrollments untouched, so we never wipe access by accident.
        // courseIds === null means "skip the replace entirely".
        if (data.courses === 'all' || Array.isArray(data.courses)) {
          let courseIds: string[] | null = null;
          if (data.courses === 'all') {
            const { data: allCourses } = await supabase
              .from('courses')
              .select('id')
              .eq('is_published', true);
            courseIds = allCourses?.map(c => c.id) || [];
          } else {
            // Validate caller-supplied ids against real courses (deduped) so a
            // bad id can't FK-fail the insert AFTER we've deleted the old rows.
            const requested = [...new Set((data.courses as unknown[]).filter(Boolean).map(String))];
            if (requested.length === 0) {
              courseIds = []; // explicit empty array → remove all access
            } else {
              const { data: validCourses } = await supabase.from('courses').select('id').in('id', requested);
              const validIds = validCourses?.map(c => c.id) || [];
              if (validIds.length === 0) {
                // Non-empty request but no id resolved → don't wipe; flag it.
                console.warn('[API users.create] courses had no valid ids — leaving enrollments unchanged');
              } else {
                courseIds = validIds;
              }
            }
          }

          if (courseIds !== null) {
            const { error: delEnrollErr } = await supabase.from('enrollments').delete().eq('user_id', userId);
            if (delEnrollErr) console.error('[API users.create] enrollments delete failed:', delEnrollErr);
            if (courseIds.length > 0) {
              const { error: insEnrollErr } = await supabase.from('enrollments').insert(
                courseIds.map((courseId) => ({ user_id: userId, course_id: courseId, progress_percentage: 0 })),
              );
              if (insEnrollErr) console.error('[API users.create] enrollments insert failed:', insEnrollErr);
            }
          }
        }

        // 4) Time limit — desired-state, only for non-staff student/lead:
        //   * access_hours > 0 → set/replace the limit (source 'api').
        //   * absent or 0      → CLEAR any existing limit (full access).
        // When it expires, a server-side sweep deletes the user's enrollments
        // and downgrades them to 'lead' (migration 20260623120000).
        let accessExpiresAt: string | null = null;
        if (!isPrivileged) {
          if (accessHours !== null && accessHours > 0 && (resolvedRole === 'student' || resolvedRole === 'lead')) {
            accessExpiresAt = new Date(Date.now() + accessHours * 3600_000).toISOString();
            const { error: limitError } = await supabase.from('access_limits').upsert({
              user_id: userId,
              expires_at: accessExpiresAt,
              revoked_at: null,
              created_by: null,
              source: 'api',
              updated_at: new Date().toISOString(),
            });
            if (limitError) {
              console.error('[API users.create] access_limits upsert failed:', limitError);
            }
          } else {
            // No (or zero) hours → ensure no limit. No-op for a brand-new user.
            const { error: clearError } = await supabase.from('access_limits').delete().eq('user_id', userId);
            if (clearError) {
              console.error('[API users.create] access_limits clear failed:', clearError);
            }
          }
        }

        // Fire the invite email for BRAND-NEW accounts only (existing users
        // already have an account and we didn't touch their password).
        // Best-effort — never fail on mail dispatch. We send X-Internal-Secret
        // because the external-api caller has no user JWT and send-invite-email
        // is normally JWT-gated to admin/instructor.
        if (!isUpdate) {
          const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
          if (internalSecret) {
            try {
              const inviteResp = await fetch(`${supabaseUrl}/functions/v1/send-invite-email`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-internal-secret': internalSecret,
                },
                body: JSON.stringify({
                  email,
                  fullName,
                  tempPassword: data.password,
                }),
              });
              if (!inviteResp.ok) {
                console.warn(
                  `[API users.create] invite email dispatch returned ${inviteResp.status} for ${hashApiKey(email)} — user is created, admin can resend manually`,
                );
              }
            } catch (e) {
              console.warn('[API users.create] invite email dispatch error:', e);
            }
          } else {
            console.warn('[API users.create] INTERNAL_FUNCTION_SECRET not configured — no invite email sent');
          }
        }

        return await sendResponse(jsonResponse({
          user: {
            id: userId,
            email,
            full_name: fullName,
            phone: data.phone || null,
            role: isPrivileged ? undefined : resolvedRole,
            access_expires_at: accessExpiresAt,
          },
          updated: isUpdate,
          staff_protected: isPrivileged,
          message: isUpdate
            ? (isPrivileged
                ? 'User already existed (staff) — details and enrollments updated; role and time limit left unchanged'
                : 'User already existed — updated')
            : 'User created successfully',
        }));
      }

      case 'users.search': {
        // Build query based on search parameters
        let query = supabase.from('profiles').select('id, email, full_name, avatar_url, phone, join_date, created_at');

        // Apply search filters
        if (data?.email) {
          query = query.ilike('email', `%${data.email}%`);
        }
        if (data?.name || data?.full_name) {
          query = query.ilike('full_name', `%${data.name || data.full_name}%`);
        }
        if (data?.phone) {
          query = query.ilike('phone', `%${data.phone}%`);
        }

        // Apply pagination
        const limit = data?.limit || 50;
        const offset = data?.offset || 0;
        query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

        const { data: users, error } = await query;

        if (error) throw error;

        return await sendResponse(jsonResponse({ users, total: users?.length || 0 }));
      }

      case 'users.inactivityByPhone': {
        // "The customer gave me this phone number — how many days since they
        // were last on the platform?"
        //
        // Deliberately NOT routed through users.search. That action's
        // ilike('phone', '%…%') is a raw substring compare that cannot cross a
        // formatting boundary: a caller's '+972501234567' never finds the
        // stored '050-1234567', and 71 of the 104 live numbers are written in
        // exactly that national form. See _shared/phone-match.ts for why the
        // matcher compares digit SUFFIXES instead.
        const phoneInput = data?.phone;
        if (phoneInput === undefined || phoneInput === null || (typeof phoneInput === 'string' && phoneInput.trim() === '')) {
          return await sendResponse(errorResponse('phone is required', 'VALIDATION_ERROR'), 'phone is required');
        }
        if (!isMatchableInput(phoneInput)) {
          // Never put the phone in either string: the second one lands in
          // api_request_logs.error_message, which redactForLog does not cover.
          return await sendResponse(
            errorResponse(`phone must contain at least ${MATCH_DIGITS_MIN} digits`, 'VALIDATION_ERROR'),
            'phone below minimum digit length',
          );
        }

        // ---- Candidate fetch: a SQL narrowing that cannot produce a false negative.
        //
        // profiles.phone is free text ('050-1234567', '+972 50 123 4567',
        // '5491122334455'), so the matcher's "last N digits are equal" test has
        // no indexable SQL equivalent. What CAN be pushed down is a strict
        // SUPERSET of it: if a row's digit tail ends with the query's last 8
        // digits, then those 8 digits appear in that row IN ORDER, separated by
        // whatever punctuation the admin happened to type. The pattern
        // '%5%0%1%2%3%4%5%6%' tests exactly that. 8 (MATCH_DIGITS_MIN) is used
        // rather than 9 because the matcher's second rung compares only 8 — so
        // one pattern covers both rungs and can never drop a real match.
        // The digits come from toDigits(), i.e. [0-9] only, so the pattern
        // cannot smuggle in a LIKE metacharacter (nor a ',' or ')' that would
        // break out of the or() filter below).
        //
        // ONE PATTERN PER QUERY VARIANT, OR'd. matchQueryVariants() is the
        // matcher's own list of the digit-strings it will compare — today that
        // is the query plus, for Argentina's legacy `0 area 15 subscriber`
        // spelling, the rewritten national number. A variant that deletes digits
        // from the MIDDLE of the query is not reliably found by the query's own
        // pattern, so narrowing on the query alone would let the matcher look
        // for a row the database had already filtered out.
        //
        // TRADEOFF: the leading wildcard means Postgres still sequentially scans
        // profiles — but it scans inside the database and ships back a handful
        // of rows instead of the whole table, and the authoritative decision is
        // still the in-memory matchPhone() pass below (O(candidates × 2 rungs)).
        // At today's 148 profiles / ~104 phones both halves are free.
        //
        // AS THE TABLE GROWS: the fetch is bounded, and a truncated candidate
        // set is treated as an error rather than answered, because truncation
        // could silently turn a genuinely AMBIGUOUS phone into a confident and
        // WRONG single match. Past roughly 20 000 profiles, replace this with a
        // generated column (phone_key9 = last 9 digits of phone) plus a b-tree
        // index and make it an equality lookup; the matcher stays as-is.
        const PHONE_CANDIDATE_LIMIT = 500;
        const narrowFilter = matchQueryVariants(phoneInput)
          .map((digits) => `phone.ilike.%${digits.slice(-MATCH_DIGITS_MIN).split('').join('%')}%`)
          .join(',');

        const { data: candidateRows, error: candidateError } = await supabase
          .from('profiles')
          .select('id, email, full_name, phone, join_date, created_at, deleted_at')
          .or(narrowFilter)
          .limit(PHONE_CANDIDATE_LIMIT);

        if (candidateError) throw candidateError;
        if ((candidateRows?.length || 0) >= PHONE_CANDIDATE_LIMIT) {
          throw new Error(`Phone candidate set hit the ${PHONE_CANDIDATE_LIMIT}-row cap — refusing to resolve from a truncated set`);
        }

        // Soft-deleted rows are kept: the matcher needs them to tell
        // "deleted account" apart from "never existed", and to stop a deleted
        // duplicate from reading as ambiguous.
        // The explicit annotation is load-bearing: supabase-js is untyped here,
        // so `candidateRows` is `any` and matchPhone's generic would collapse to
        // the bare PhoneCandidate, hiding full_name/email/created_at on the
        // matched row. Naming the shape keeps them on it.
        const phoneCandidates: Array<{
          id: string;
          email: string | null;
          full_name: string | null;
          phone: string | null;
          join_date: string | null;
          created_at: string | null;
          deletedAt: string | null;
        }> = (candidateRows || []).map((p: any) => ({
          id: p.id,
          email: p.email ?? null,
          full_name: p.full_name ?? null,
          phone: p.phone ?? null,
          join_date: p.join_date ?? null,
          created_at: p.created_at ?? null,
          deletedAt: p.deleted_at ?? null,
        }));

        const phoneMatch = matchPhone(phoneInput, phoneCandidates);

        // Do-not-contact (contact_suppressions, 20261015100000) rides on EVERY
        // answer, the 404s included: most numbers the WhatsApp automation checks
        // are not portal users, and a lead who asked to be removed must be
        // skipped too. True if the number itself is listed, or any account it
        // matches is (by account, profile phone or profile email). A failed
        // check throws (→ 500) rather than answering false.
        const doNotContact = async (userIds: Array<string | null>): Promise<boolean> => {
          for (const userId of userIds.length ? userIds : [null]) {
            const { data: listed, error: listError } = await supabase.rpc('is_contact_suppressed', {
              _user_id: userId,
              _phone: String(phoneInput),
              _email: null,
            });
            if (listError) throw listError;
            if (listed === true) return true;
          }
          return false;
        };

        if (phoneMatch.status === 'ambiguous') {
          // Terminal, never a tie-break. Four production buckets are genuinely
          // ambiguous (two are two different people sharing one handset), and
          // picking one would report the wrong customer's inactivity. Only the
          // COUNT goes back — the other profiles' names, emails and ids stay in.
          console.warn(`[API users.inactivityByPhone] ambiguous: ${phoneMatch.matches.length} live profiles on rung ${phoneMatch.matchedOn}`);
          return await sendResponse(
            jsonResponse({
              error: 'That phone number matches more than one active user. Identify the right one by name or email with users.search, then call users.get with their user_id.',
              code: 'AMBIGUOUS_PHONE',
              match_count: phoneMatch.matches.length,
              // A shared handset: if ANY of its owners asked to be removed, the number is off-limits.
              do_not_contact: await doNotContact(phoneMatch.matches.map((m) => m.id)),
            }, 409),
            'Ambiguous phone number',
          );
        }

        if (phoneMatch.status === 'matched_deleted') {
          // Distinct from NOT_FOUND on purpose: "deleted" is not "never existed".
          return await sendResponse(
            jsonResponse({
              error: 'That phone number belongs to a deleted user',
              code: 'PROFILE_DELETED',
              do_not_contact: await doNotContact(phoneMatch.matches.map((m) => m.id)),
            }, 404),
            'Phone belongs to a deleted user',
          );
        }

        if (phoneMatch.status !== 'matched') {
          // not_found (invalid_input is already handled by isMatchableInput above).
          return await sendResponse(
            jsonResponse({
              error: 'No user matches that phone number',
              code: 'NOT_FOUND',
              do_not_contact: await doNotContact([]),
            }, 404),
            'No user matches that phone',
          );
        }

        const inactivityProfile = phoneMatch.matches[0];

        // ---- Presence signals.
        //
        // The instant activity tracking began. student_activity was created and
        // backfilled on 2026-08-23; anything at or before this instant was
        // RECONSTRUCTED by 20260823120000_lifecycle_backfill_activity.sql, not
        // observed — and 47 rows carry this exact timestamp because that
        // migration's COALESCE(..., now()) branch fired for every account with
        // no evidence at all.
        const ACTIVITY_TRACKING_SINCE = '2026-08-23T10:14:23.422Z';
        const DAY_MS = 86_400_000;
        const HOUR_MS = 3_600_000;
        const measuredAt = new Date();

        const [activityRes, lessonRes, authEventRes, authUserRes] = await Promise.all([
          supabase
            .from('student_activity')
            .select('last_active_at')
            .eq('user_id', inactivityProfile.id)
            .maybeSingle(),
          supabase
            .from('lesson_completions')
            .select('completed_at')
            .eq('user_id', inactivityProfile.id)
            .order('completed_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('user_activities')
            .select('created_at')
            // password_reset rows are written by an ADMIN (admin-user-actions),
            // not by the student. Counting them is exactly the bug that gave 3
            // never-signed-in accounts a fake last_active_at in the backfill.
            .neq('activity_type', 'password_reset')
            .eq('user_id', inactivityProfile.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase.auth.admin.getUserById(inactivityProfile.id),
        ]);

        if (activityRes.error) throw activityRes.error;
        if (lessonRes.error) throw lessonRes.error;
        if (authEventRes.error) throw authEventRes.error;
        if (authUserRes.error && (authUserRes.error as any)?.status !== 404) {
          // A profile whose auth user is gone is a data inconsistency, not a
          // server fault — fall through with no sign-in signal. Anything else
          // is a real GoTrue failure and must not be silently downgraded,
          // because the never-signed-in gate below depends on this answer.
          throw authUserRes.error;
        }

        const activityPingAt = (activityRes.data?.last_active_at ?? null) as string | null;
        const lastLessonCompletedAt = (lessonRes.data?.completed_at ?? null) as string | null;
        const lastAuthEventAt = (authEventRes.data?.created_at ?? null) as string | null;
        const lastSignInAt = (authUserRes.data?.user?.last_sign_in_at ?? null) as string | null;

        // ---- Gate 0: has this account EVER been signed into?
        //
        // 52 of the 148 accounts (and 52 of the 104 that have a phone) were
        // created by an admin and have never once been signed into — mostly one
        // bulk import. 50 of them still carry a student_activity row from the
        // backfill, so a naive now() - last_active_at answers a flat, fabricated
        // number for half the population this endpoint exists to serve. A real
        // ping written after tracking started overrides the gate; the synthetic
        // backfill instant (which is not strictly after it) does not.
        const trackingSinceMs = Date.parse(ACTIVITY_TRACKING_SINCE);
        const activityPingMs = activityPingAt ? Date.parse(activityPingAt) : null;
        const neverActive = lastSignInAt === null
          && !(activityPingMs !== null && Number.isFinite(activityPingMs) && activityPingMs > trackingSinceMs);

        // ---- Ladder: the latest instant wins, and the winner names the source.
        // Listed in tie-break priority order, so a strict > keeps the strongest
        // label when two signals land on the same instant.
        // profiles.created_at is deliberately NOT a rung — a signup is not a
        // visit. It is reported separately as days_since_signup.
        const inactivitySources: Array<{ source: string; at: string | null }> = [
          { source: 'activity_ping', at: activityPingAt },
          { source: 'lesson_completion', at: lastLessonCompletedAt },
          { source: 'auth_event', at: lastAuthEventAt },
          { source: 'sign_in', at: lastSignInAt },
        ];

        let lastActiveAt: string | null = null;
        let lastActiveSource = 'none';
        let bestMs = Number.NEGATIVE_INFINITY;
        for (const candidate of inactivitySources) {
          if (!candidate.at) continue;
          const t = Date.parse(candidate.at);
          if (!Number.isFinite(t) || t <= bestMs) continue;
          bestMs = t;
          lastActiveAt = candidate.at;
          lastActiveSource = candidate.source;
        }

        if (neverActive) {
          // Not a big number — null. A caller doing `days_inactive ?? 999` must
          // be forced to notice that "never activated" is a different population
          // from "lapsed student".
          lastActiveAt = null;
          lastActiveSource = 'none';
        }

        // Floor of elapsed hours / 24. Instant arithmetic, identical in every
        // timezone — the roster spans Israel (UTC+3) to Mexico (UTC-6) and the
        // codebase defines no server timezone anywhere. Matches how
        // _shared/lifecycle.ts thresholds the 7-day win-back email off the same
        // column. Clamped at 0: a ping can legitimately land a few ms in the
        // future under clock skew, and 0 is the right answer, not -1.
        const elapsedMs = lastActiveAt === null
          ? null
          : Math.max(0, measuredAt.getTime() - Date.parse(lastActiveAt));
        const daysInactive = elapsedMs === null ? null : Math.floor(elapsedMs / DAY_MS);
        const hoursInactive = elapsedMs === null ? null : Math.floor(elapsedMs / HOUR_MS);

        const createdAtMs = inactivityProfile.created_at ? Date.parse(inactivityProfile.created_at) : NaN;
        const daysSinceSignup = Number.isFinite(createdAtMs)
          ? Math.floor(Math.max(0, measuredAt.getTime() - createdAtMs) / DAY_MS)
          : null;

        // high = the winning instant is real evidence observed after tracking
        //        started, or a certain "never" (which is a certainty, not a guess).
        // low  = reconstructed from pre-tracking evidence.
        //
        // The test is on the INSTANT, not on which source label won it. A lesson
        // completion or a login event is directly observed, exactly as
        // trustworthy as a ping — and it routinely outranks the ping, because
        // useActivityPing is throttled to once an hour while AuthContext writes
        // an auth row on every sign-in. Gating on the label marked most of
        // today's genuinely-active users 'low' with an empty caveats array,
        // which both contradicted itself and diluted the warning that exists to
        // flag the reconstructed answers.
        //
        // Strictly AFTER the tracking instant, matching gate 0: the synthetic
        // backfill timestamp is equal to it, and it is not evidence.
        const lastActiveMs = lastActiveAt === null ? NaN : Date.parse(lastActiveAt);
        const observedAfterTracking = Number.isFinite(lastActiveMs) && lastActiveMs > trackingSinceMs;
        const inactivityConfidence = neverActive || observedAfterTracking ? 'high' : 'low';

        const inactivityCaveats: string[] = [];
        if (neverActive) inactivityCaveats.push('never_signed_in');
        if (activityPingAt === null) inactivityCaveats.push('no_activity_ping_row');
        // Same boundary as `observedAfterTracking`, so a 'low' answer always
        // carries a machine-readable reason and the two fields cannot disagree.
        if (!neverActive && lastActiveAt !== null && !observedAfterTracking) {
          inactivityCaveats.push('before_activity_tracking');
        }
        if (!neverActive && lastActiveSource === 'sign_in') inactivityCaveats.push('sign_in_only');

        // No phone, name or email in this line — a spike in rung-8 resolutions
        // is the early warning that 8-digit numbers are arriving in bulk.
        console.log(`[API users.inactivityByPhone] rung=${phoneMatch.matchedOn} source=${lastActiveSource} confidence=${inactivityConfidence}`);

        // One timestamp shape for the whole payload. PostgREST hands back
        // '2026-07-28T18:55:14.72129+00:00' (5-6 fractional digits, +00:00) and
        // GoTrue hands back 6 fractional digits with a Z, while measured_at and
        // activity_tracking_since are '.mmmZ' — three shapes in one body, and
        // strict ISO parsers (python's datetime.fromisoformat before 3.11
        // among them) reject the PostgREST one outright. Normalising here, at
        // the boundary, leaves the arithmetic above untouched: it already ran
        // off the raw strings via Date.parse.
        // join_date is NOT run through this — it is a DATE ('2026-06-23'), and
        // turning it into an instant would invent a time of day.
        const iso = (value: string | null): string | null => {
          if (!value) return null;
          const ms = Date.parse(value);
          return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
        };

        const inactivityDoNotContact = await doNotContact([inactivityProfile.id]);

        return await sendResponse(jsonResponse({
          do_not_contact: inactivityDoNotContact,
          user: {
            id: inactivityProfile.id,
            full_name: inactivityProfile.full_name,
            email: inactivityProfile.email,
            // Echoed back EXACTLY as stored, never normalized, so the caller can
            // eyeball it against what they sent before acting on it.
            phone: inactivityProfile.phone,
            created_at: iso(inactivityProfile.created_at),
            join_date: inactivityProfile.join_date,
          },
          days_inactive: daysInactive,
          hours_inactive: hoursInactive,
          last_active_at: iso(lastActiveAt),
          last_active_source: lastActiveSource,
          never_active: neverActive,
          days_since_signup: daysSinceSignup,
          confidence: inactivityConfidence,
          signals: {
            activity_ping_at: iso(activityPingAt),
            last_sign_in_at: iso(lastSignInAt),
            last_lesson_completed_at: iso(lastLessonCompletedAt),
            last_auth_event_at: iso(lastAuthEventAt),
          },
          caveats: inactivityCaveats,
          activity_tracking_since: ACTIVITY_TRACKING_SINCE,
          measured_at: measuredAt.toISOString(),
          day_count_rule: 'floor_elapsed_hours_div_24_utc',
        }));
      }

      // ===== DO-NOT-CONTACT LIST =====
      // contact_suppressions (20261015100000): whoever is on it gets nothing from
      // the portal, and every automation reading this API must skip them too.
      // Keyed by phone (last 9 digits) and/or email, so it also covers people
      // who are not portal users. Writes from the API are labelled source 'api'.
      case 'contacts.optOut':
      case 'contacts.optIn':
      case 'contacts.status': {
        const phoneKey = data?.phone != null && data.phone !== '' ? contactPhoneKey(data.phone) : null;
        const emailKey = contactEmailKey(data?.email);
        if (data?.phone != null && data.phone !== '' && !phoneKey) {
          return await sendResponse(errorResponse(`phone must contain at least ${MATCH_DIGITS_MIN} digits`, 'VALIDATION_ERROR'), 'phone below minimum digit length');
        }
        if (emailKey && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailKey)) {
          return await sendResponse(errorResponse('email is not a valid address', 'VALIDATION_ERROR'), 'invalid email');
        }
        if (!phoneKey && !emailKey) {
          return await sendResponse(errorResponse('phone or email is required', 'VALIDATION_ERROR'), 'phone or email is required');
        }

        if (action === 'contacts.optOut') {
          const reason = typeof data?.reason === 'string' ? data.reason.slice(0, 500) : null;
          // One row per identifier: a phone already listed must not stop the email being added.
          const rows: Array<Record<string, string | null>> = [
            ...(phoneKey ? [{ phone: String(data?.phone), reason, source: 'api' }] : []),
            ...(emailKey ? [{ email: emailKey, reason, source: 'api' }] : []),
          ];
          for (const row of rows) {
            const { error: insertError } = await supabase.from('contact_suppressions').insert(row);
            // 23505: already listed — opting out twice is a success, not an error.
            if (insertError && insertError.code !== '23505') throw insertError;
          }
        } else if (action === 'contacts.optIn') {
          // The API may only undo its OWN entries: a removal the person asked for
          // in the portal, or that an admin recorded, is not an automation's to reverse.
          // Two parameterised deletes, never an .or() string built from caller input.
          for (const [column, key] of [['phone_key', phoneKey], ['email_key', emailKey]] as const) {
            if (!key) continue;
            const { error: deleteError } = await supabase
              .from('contact_suppressions')
              .delete()
              .eq('source', 'api')
              .eq(column, key);
            if (deleteError) throw deleteError;
          }
        }

        const { data: listed, error: statusError } = await supabase.rpc('is_contact_suppressed', {
          _user_id: null,
          _phone: phoneKey ? String(data?.phone) : null,
          _email: emailKey,
        });
        if (statusError) throw statusError;
        return await sendResponse(jsonResponse({ do_not_contact: listed === true }));
      }

      case 'users.delete': {
        if (!data?.user_id) {
          return await sendResponse(errorResponse('user_id is required', 'VALIDATION_ERROR'), 'user_id is required');
        }

        const { error } = await supabase.auth.admin.deleteUser(data.user_id);
        if (error) throw error;
        return await sendResponse(jsonResponse({ success: true, message: 'User deleted' }));
      }

      case 'users.updatePassword': {
        if (!data?.user_id || !data?.password) {
          return await sendResponse(errorResponse('user_id and password are required', 'VALIDATION_ERROR'), 'user_id and password are required');
        }
        if (data.password.length < 6) {
          return await sendResponse(errorResponse('Password must be at least 6 characters', 'VALIDATION_ERROR'), 'Password too short');
        }

        const { error } = await supabase.auth.admin.updateUserById(data.user_id, { password: data.password });
        if (error) throw error;

        return await sendResponse(jsonResponse({ success: true, message: 'Password updated' }));
      }

      // ===== COURSES =====
      case 'courses.list': {
        const { data: courses, error } = await supabase
          .from('courses')
          .select('id, title, description, thumbnail_url, is_published, created_at, updated_at')
          .order('order_index', { ascending: true });

        if (error) throw error;
        return await sendResponse(jsonResponse({ courses }));
      }

      case 'courses.get': {
        if (!data?.course_id) {
          return await sendResponse(errorResponse('course_id is required', 'VALIDATION_ERROR'), 'course_id is required');
        }

        const { data: course, error } = await supabase
          .from('courses')
          .select(`id, title, description, thumbnail_url, is_published, payment_url, created_at, updated_at,
            modules(id, title, description, order_index, lessons(id, title, lesson_type, duration_minutes, order_index))`)
          .eq('id', data.course_id)
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            return await sendResponse(errorResponse('Course not found', 'NOT_FOUND', 404), 'Course not found');
          }
          throw error;
        }
        return await sendResponse(jsonResponse({ course }));
      }

      case 'courses.create': {
        if (!data?.title) {
          return await sendResponse(errorResponse('title is required', 'VALIDATION_ERROR'), 'title is required');
        }

        const { data: maxOrder } = await supabase.from('courses').select('order_index').order('order_index', { ascending: false }).limit(1).single();

        const insertData: Record<string, any> = {
          title: data.title,
          description: data.description || null,
          thumbnail_url: data.thumbnail_url || null,
          payment_url: data.payment_url || null,
          is_published: data.is_published || false,
          order_index: (maxOrder?.order_index || 0) + 1,
        };

        const { data: course, error } = await supabase
          .from('courses')
          .insert(insertData)
          .select()
          .single();

        if (error) throw error;
        return await sendResponse(jsonResponse({ course, message: 'Course created' }));
      }

      case 'courses.update': {
        if (!data?.course_id) {
          return await sendResponse(errorResponse('course_id is required', 'VALIDATION_ERROR'), 'course_id is required');
        }

        const updateData: Record<string, any> = {};
        if (data.title !== undefined) updateData.title = data.title;
        if (data.description !== undefined) updateData.description = data.description;
        if (data.thumbnail_url !== undefined) updateData.thumbnail_url = data.thumbnail_url;
        if (data.payment_url !== undefined) updateData.payment_url = data.payment_url;
        if (data.is_published !== undefined) updateData.is_published = data.is_published;
        if (data.order_index !== undefined) updateData.order_index = data.order_index;

        const { data: course, error } = await supabase.from('courses').update(updateData).eq('id', data.course_id).select().single();

        if (error) throw error;
        return await sendResponse(jsonResponse({ course, message: 'Course updated' }));
      }

      case 'courses.delete': {
        if (!data?.course_id) {
          return await sendResponse(errorResponse('course_id is required', 'VALIDATION_ERROR'), 'course_id is required');
        }

        const { error } = await supabase.from('courses').delete().eq('id', data.course_id);
        if (error) throw error;
        return await sendResponse(jsonResponse({ success: true, message: 'Course deleted' }));
      }

      case 'courses.publish': {
        if (!data?.course_id) {
          return await sendResponse(errorResponse('course_id is required', 'VALIDATION_ERROR'), 'course_id is required');
        }

        const { error } = await supabase.from('courses').update({ is_published: true }).eq('id', data.course_id);
        if (error) throw error;
        return await sendResponse(jsonResponse({ success: true, message: 'Course published' }));
      }

      case 'courses.unpublish': {
        if (!data?.course_id) {
          return await sendResponse(errorResponse('course_id is required', 'VALIDATION_ERROR'), 'course_id is required');
        }

        const { error } = await supabase.from('courses').update({ is_published: false }).eq('id', data.course_id);
        if (error) throw error;
        return await sendResponse(jsonResponse({ success: true, message: 'Course unpublished' }));
      }

      // ===== MODULES =====
      case 'modules.list': {
        if (!data?.course_id) {
          return await sendResponse(errorResponse('course_id is required', 'VALIDATION_ERROR'), 'course_id is required');
        }

        const { data: modules, error } = await supabase.from('modules').select('id, title, description, order_index, created_at').eq('course_id', data.course_id).order('order_index', { ascending: true });
        if (error) throw error;
        return await sendResponse(jsonResponse({ modules }));
      }

      case 'modules.create': {
        if (!data?.course_id || !data?.title) {
          return await sendResponse(errorResponse('course_id and title are required', 'VALIDATION_ERROR'), 'course_id and title are required');
        }

        const { data: maxOrder } = await supabase.from('modules').select('order_index').eq('course_id', data.course_id).order('order_index', { ascending: false }).limit(1).single();

        const { data: module, error } = await supabase.from('modules').insert({
          course_id: data.course_id,
          title: data.title,
          description: data.description || null,
          order_index: (maxOrder?.order_index || 0) + 1
        }).select().single();

        if (error) throw error;
        return await sendResponse(jsonResponse({ module, message: 'Module created' }));
      }

      case 'modules.update': {
        if (!data?.module_id) {
          return await sendResponse(errorResponse('module_id is required', 'VALIDATION_ERROR'), 'module_id is required');
        }

        const updateData: Record<string, any> = {};
        if (data.title !== undefined) updateData.title = data.title;
        if (data.description !== undefined) updateData.description = data.description;
        if (data.order_index !== undefined) updateData.order_index = data.order_index;

        const { data: module, error } = await supabase.from('modules').update(updateData).eq('id', data.module_id).select().single();
        if (error) throw error;
        return await sendResponse(jsonResponse({ module, message: 'Module updated' }));
      }

      case 'modules.delete': {
        if (!data?.module_id) {
          return await sendResponse(errorResponse('module_id is required', 'VALIDATION_ERROR'), 'module_id is required');
        }

        const { error } = await supabase.from('modules').delete().eq('id', data.module_id);
        if (error) throw error;
        return await sendResponse(jsonResponse({ success: true, message: 'Module deleted' }));
      }

      // ===== LESSONS =====
      case 'lessons.list': {
        if (!data?.module_id) {
          return await sendResponse(errorResponse('module_id is required', 'VALIDATION_ERROR'), 'module_id is required');
        }

        const { data: lessons, error } = await supabase.from('lessons').select('*').eq('module_id', data.module_id).order('order_index', { ascending: true });
        if (error) throw error;
        return await sendResponse(jsonResponse({ lessons }));
      }

      case 'lessons.create': {
        if (!data?.module_id || !data?.title) {
          return await sendResponse(errorResponse('module_id and title are required', 'VALIDATION_ERROR'), 'module_id and title are required');
        }

        const { data: maxOrder } = await supabase.from('lessons').select('order_index').eq('module_id', data.module_id).order('order_index', { ascending: false }).limit(1).single();

        const { data: lesson, error } = await supabase.from('lessons').insert({
          module_id: data.module_id,
          title: data.title,
          lesson_type: data.lesson_type || 'video',
          video_url: data.video_url || null,
          embed_url: data.embed_url || null,
          content_text: data.content_text || null,
          file_url: data.file_url || null,
          resources_url: data.resources_url || null,
          duration_minutes: data.duration_minutes || null,
          order_index: (maxOrder?.order_index || 0) + 1
        }).select().single();

        if (error) throw error;
        return await sendResponse(jsonResponse({ lesson, message: 'Lesson created' }));
      }

      case 'lessons.update': {
        if (!data?.lesson_id) {
          return await sendResponse(errorResponse('lesson_id is required', 'VALIDATION_ERROR'), 'lesson_id is required');
        }

        const updateData: Record<string, any> = {};
        if (data.title !== undefined) updateData.title = data.title;
        if (data.lesson_type !== undefined) updateData.lesson_type = data.lesson_type;
        if (data.video_url !== undefined) updateData.video_url = data.video_url;
        if (data.embed_url !== undefined) updateData.embed_url = data.embed_url;
        if (data.content_text !== undefined) updateData.content_text = data.content_text;
        if (data.file_url !== undefined) updateData.file_url = data.file_url;
        if (data.resources_url !== undefined) updateData.resources_url = data.resources_url;
        if (data.duration_minutes !== undefined) updateData.duration_minutes = data.duration_minutes;
        if (data.order_index !== undefined) updateData.order_index = data.order_index;

        const { data: lesson, error } = await supabase.from('lessons').update(updateData).eq('id', data.lesson_id).select().single();
        if (error) throw error;
        return await sendResponse(jsonResponse({ lesson, message: 'Lesson updated' }));
      }

      case 'lessons.delete': {
        if (!data?.lesson_id) {
          return await sendResponse(errorResponse('lesson_id is required', 'VALIDATION_ERROR'), 'lesson_id is required');
        }

        const { error } = await supabase.from('lessons').delete().eq('id', data.lesson_id);
        if (error) throw error;
        return await sendResponse(jsonResponse({ success: true, message: 'Lesson deleted' }));
      }

      // ===== ENROLLMENTS =====
      case 'enrollments.list': {
        let query = supabase.from('enrollments').select(`id, user_id, course_id, progress_percentage, enrolled_at, profiles:user_id(full_name, email), courses:course_id(title)`).order('enrolled_at', { ascending: false });

        if (data?.user_id) query = query.eq('user_id', data.user_id);
        if (data?.course_id) query = query.eq('course_id', data.course_id);

        const { data: enrollments, error } = await query.limit(data?.limit || 100);
        if (error) throw error;
        return await sendResponse(jsonResponse({ enrollments }));
      }

      case 'enrollments.create': {
        if (!data?.user_id || !data?.course_id) {
          return await sendResponse(errorResponse('user_id and course_id are required', 'VALIDATION_ERROR'), 'user_id and course_id are required');
        }

        const { data: existing } = await supabase.from('enrollments').select('id').eq('user_id', data.user_id).eq('course_id', data.course_id).single();
        if (existing) {
          return await sendResponse(errorResponse('User is already enrolled in this course', 'CONFLICT'), 'Already enrolled');
        }

        const insertData: Record<string, any> = {
          user_id: data.user_id,
          course_id: data.course_id,
        };

        const { data: enrollment, error } = await supabase.from('enrollments').insert(insertData).select().single();
        if (error) throw error;
        return await sendResponse(jsonResponse({ enrollment, message: 'User enrolled successfully' }));
      }

      case 'enrollments.delete': {
        if (!data?.user_id || !data?.course_id) {
          return await sendResponse(errorResponse('user_id and course_id are required', 'VALIDATION_ERROR'), 'user_id and course_id are required');
        }

        const { error } = await supabase.from('enrollments').delete().eq('user_id', data.user_id).eq('course_id', data.course_id);
        if (error) throw error;
        return await sendResponse(jsonResponse({ success: true, message: 'Enrollment removed' }));
      }

      case 'enrollments.updateProgress': {
        if (!data?.user_id || !data?.course_id || data?.progress_percentage === undefined) {
          return await sendResponse(errorResponse('user_id, course_id and progress_percentage are required', 'VALIDATION_ERROR'), 'Missing fields');
        }

        const { error } = await supabase.from('enrollments').update({ progress_percentage: data.progress_percentage }).eq('user_id', data.user_id).eq('course_id', data.course_id);
        if (error) throw error;
        return await sendResponse(jsonResponse({ success: true, message: 'Progress updated' }));
      }

      // ===== ACTIVITIES =====
      case 'activities.list': {
        let query = supabase.from('user_activities').select('*').order('created_at', { ascending: false });
        if (data?.user_id) query = query.eq('user_id', data.user_id);
        if (data?.activity_type) query = query.eq('activity_type', data.activity_type);
        if (data?.from_date) query = query.gte('created_at', data.from_date);
        if (data?.to_date) query = query.lte('created_at', data.to_date);
        const { data: activities, error } = await query.limit(data?.limit || 100);
        if (error) throw error;
        return await sendResponse(jsonResponse({ activities }));
      }

      // ===== ANNOUNCEMENTS =====
      case 'announcements.list': {
        const { data: announcements, error } = await supabase
          .from('announcements')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) throw error;
        return await sendResponse(jsonResponse({ announcements }));
      }

      case 'announcements.create': {
        if (!data?.title || !data?.content) {
          return await sendResponse(errorResponse('title and content are required', 'VALIDATION_ERROR'), 'title and content are required');
        }

        const insertData: Record<string, any> = {
          title: data.title,
          content: data.content,
          is_pinned: data.is_pinned || false,
          author_id: data.author_id || null,
        };

        const { data: announcement, error } = await supabase.from('announcements').insert(insertData).select().single();
        if (error) throw error;
        return await sendResponse(jsonResponse({ announcement, message: 'Announcement created' }));
      }

      case 'announcements.delete': {
        if (!data?.announcement_id) {
          return await sendResponse(errorResponse('announcement_id is required', 'VALIDATION_ERROR'), 'announcement_id is required');
        }

        const { error } = await supabase.from('announcements').delete().eq('id', data.announcement_id);
        if (error) throw error;
        return await sendResponse(jsonResponse({ success: true, message: 'Announcement deleted' }));
      }

      // ===== EVENTS =====
      case 'events.list': {
        const { data: events, error } = await supabase
          .from('events')
          .select('*')
          .order('start_time', { ascending: true });
        if (error) throw error;
        return await sendResponse(jsonResponse({ events }));
      }

      case 'events.create': {
        if (!data?.title || !data?.start_time || !data?.end_time) {
          return await sendResponse(errorResponse('title, start_time and end_time are required', 'VALIDATION_ERROR'), 'Missing required fields');
        }

        const insertData: Record<string, any> = {
          title: data.title,
          description: data.description || null,
          start_time: data.start_time,
          end_time: data.end_time,
          location: data.location || null,
          meeting_url: data.meeting_url || null,
          created_by: data.created_by || null,
        };

        const { data: event, error } = await supabase.from('events').insert(insertData).select().single();
        if (error) throw error;
        return await sendResponse(jsonResponse({ event, message: 'Event created' }));
      }

      // ===== STATS =====
      case 'stats.overview': {
        const [usersResult, coursesResult, enrollmentsResult] = await Promise.all([
          supabase.from('profiles').select('id', { count: 'exact', head: true }),
          supabase.from('courses').select('id', { count: 'exact', head: true }).eq('is_published', true),
          supabase.from('enrollments').select('id', { count: 'exact', head: true }),
        ]);

        return await sendResponse(jsonResponse({
          stats: {
            total_users: usersResult.count || 0,
            published_courses: coursesResult.count || 0,
            total_enrollments: enrollmentsResult.count || 0,
          },
        }));
      }

      default:
        console.warn(`[API] Unknown action: ${action}`);
        return await sendResponse(errorResponse(`Unknown action: ${action}`, 'INVALID_ACTION', 400), `Unknown action: ${action}`);
    }
  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[API] Error in ${action}:`, errorMessage);

    await logRequest(supabase, apiKeyHash, action, 500, responseTime, errorMessage, requestData, ipAddress, userAgent);

    return new Response(
      JSON.stringify({ error: errorMessage, code: 'INTERNAL_ERROR' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
