// sync-subscriptions-sheet — copy the "תלמידים" tab of the customer-tracking
// Google Sheet into public.student_subscriptions, for the revenue dashboard on
// /admin/users.
//
// Triggered hourly by pg_cron (migration 20261010120000_student_subscriptions)
// and by the dashboard's "Sync now" button. The sheet stays the source of
// truth: each run replaces the table wholesale, atomically, through
// replace_student_subscriptions(). Parsing, matching and date estimation live
// in _shared/subscription-sheet.ts.
//
// The sheet is read through a small Apps Script web app (the "bridge",
// scripts/sheet-bridge/Code.gs) running under a Google account that can open
// the sheet — no Google Cloud project or sharing needed. It answers only to
// the shared token.
//
// verify_jwt=false because cron has no JWT, so the function authenticates
// every caller itself BEFORE touching anything:
//   - cron: x-cron-secret header, checked against the Vault secret through
//     check_subscriptions_sync_secret() (the secret never leaves the database);
//   - "Sync now": the signed-in user's JWT, which must belong to an admin or
//     super_admin.
// Anyone else gets a 401 and no run is logged. The body is ignored. The
// response carries counts and an error CODE only — never a name, email or
// phone. A run is skipped while another is in flight or one succeeded under a
// minute ago.
//
// Secrets: SHEET_BRIDGE_URL (the web app's /exec URL), SHEET_BRIDGE_TOKEN.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  parseSheet, parseBridgeResponse, matchRow, estimateDates, HeaderNotFoundError, BridgeError,
  type ProfileLite, type ActivitySignals, type SheetRow, type RowMatch,
} from "../_shared/subscription-sheet.ts";

const THROTTLE_MS = 60_000;
const RUN_RETENTION_DAYS = 30;
const PAGE = 1000;

type ErrorCode = "not_configured" | "header_not_found" | "bridge_error" | "internal_error";

/** POST the token to the Apps Script bridge; it answers with the tab's display values. */
async function readSheet(bridgeUrl: string, token: string): Promise<string[][]> {
  let res: Response;
  try {
    // Apps Script answers a POST with a 302 to googleusercontent.com, which
    // fetch follows (as a GET) to the actual response body.
    res = await fetch(bridgeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      redirect: "follow",
    });
  } catch (e) {
    throw new BridgeError(`bridge unreachable: ${(e as Error).message}`);
  }
  return parseBridgeResponse(res.status, await res.text());
}

type Caller = "cron" | "manual";

/** Who is calling: the cron (Vault-backed secret) or a signed-in admin. null = nobody we trust. */
async function identifyCaller(req: Request, admin: SupabaseClient): Promise<Caller | null> {
  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret) {
    const { data, error } = await admin.rpc("check_subscriptions_sync_secret", { _secret: cronSecret });
    if (error) console.error("[sync-subscriptions-sheet] cron secret check failed:", error.message);
    return data === true ? "cron" : null;
  }

  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return null;
  const { data: roles, error } = await admin.from("user_roles").select("role").eq("user_id", user.id);
  if (error) throw error;
  return (roles ?? []).some((r: { role: string }) => r.role === "admin" || r.role === "super_admin") ? "manual" : null;
}

async function loadProfiles(admin: SupabaseClient): Promise<Array<ProfileLite>> {
  const out: ProfileLite[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("profiles")
      .select("id, email, phone, join_date, deleted_at")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const p of data ?? []) {
      out.push({ id: p.id, email: p.email ?? null, phone: p.phone ?? null, join_date: p.join_date ?? null, deletedAt: p.deleted_at ?? null });
    }
    if (!data || data.length < PAGE) return out;
  }
}

/**
 * The cancel-date evidence for the few students who are cancelled in the sheet
 * with no cancel date. Same signals as external-api's users.inactivityByPhone.
 */
async function loadCancelSignals(admin: SupabaseClient, userIds: string[]): Promise<Map<string, ActivitySignals>> {
  const signals = new Map<string, ActivitySignals>(userIds.map((id) => [id, {}]));
  if (userIds.length === 0) return signals;

  const [limits, pings] = await Promise.all([
    admin.from("access_limits").select("user_id, revoked_at").in("user_id", userIds),
    admin.from("student_activity").select("user_id, last_active_at").in("user_id", userIds),
  ]);
  if (limits.error) throw limits.error;
  if (pings.error) throw pings.error;
  for (const r of limits.data ?? []) signals.get(r.user_id)!.revokedAt = r.revoked_at;
  for (const r of pings.data ?? []) signals.get(r.user_id)!.activityPingAt = r.last_active_at;

  await Promise.all(userIds.map(async (id) => {
    const [lesson, event, authUser] = await Promise.all([
      admin.from("lesson_completions").select("completed_at").eq("user_id", id)
        .order("completed_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("user_activities").select("created_at").eq("user_id", id)
        // password_reset rows are written by an admin, not the student.
        .neq("activity_type", "password_reset")
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.auth.admin.getUserById(id),
    ]);
    if (lesson.error) throw lesson.error;
    if (event.error) throw event.error;
    const s = signals.get(id)!;
    s.lastLessonAt = lesson.data?.completed_at ?? null;
    s.lastAuthEventAt = event.data?.created_at ?? null;
    // A profile whose auth user is gone just has no sign-in signal.
    s.lastSignInAt = authUser.data?.user?.last_sign_in_at ?? null;
  }));

  return signals;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let trigger: Caller | null;
  try {
    trigger = await identifyCaller(req, admin);
  } catch (e) {
    console.error("[sync-subscriptions-sheet] caller check failed:", (e as { message?: string })?.message);
    return json({ ok: false, error: "internal_error" satisfies ErrorCode }, 500);
  }
  if (!trigger) return json({ ok: false, error: "unauthorized" }, 401);

  // Skip while a run is in flight, or right after a good one. Failed runs do
  // not block a retry.
  const since = new Date(Date.now() - THROTTLE_MS).toISOString();
  const { data: recent } = await admin
    .from("subscription_sync_runs").select("id")
    .gte("started_at", since).or("ok.is.null,ok.eq.true").limit(1);
  if (recent && recent.length > 0) {
    return json({ ok: true, skipped: true });
  }

  const { data: run, error: runError } = await admin
    .from("subscription_sync_runs").insert({ trigger }).select("id").single();
  if (runError) {
    console.error("[sync-subscriptions-sheet] could not open run:", runError.message);
    return json({ ok: false, error: "internal_error" satisfies ErrorCode }, 500);
  }
  const finish = (fields: Record<string, unknown>) =>
    admin.from("subscription_sync_runs").update({ finished_at: new Date().toISOString(), ...fields }).eq("id", run.id);

  const bridgeUrl = Deno.env.get("SHEET_BRIDGE_URL");
  const bridgeToken = Deno.env.get("SHEET_BRIDGE_TOKEN");
  if (!bridgeUrl || !bridgeToken) {
    await finish({ ok: false, error: "not_configured" });
    return json({ ok: false, error: "not_configured" satisfies ErrorCode });
  }

  try {
    const sheetRows: SheetRow[] = parseSheet(await readSheet(bridgeUrl, bridgeToken));
    const profiles = await loadProfiles(admin);
    const profileById = new Map(profiles.map((p) => [p.id, p]));
    const matches: RowMatch[] = sheetRows.map((r) => matchRow(r, profiles));

    const needCancelEvidence = [...new Set(sheetRows
      .map((r, i) => (r.status === "cancelled" && !r.cancelledAt ? matches[i].userId : null))
      .filter((id): id is string => id !== null))];
    const cancelSignals = await loadCancelSignals(admin, needCancelEvidence);

    const payload = sheetRows.map((r, i) => {
      const { userId, method, note } = matches[i];
      const signals: ActivitySignals = {
        ...(userId ? cancelSignals.get(userId) : undefined),
        joinDate: userId ? profileById.get(userId)?.join_date ?? null : null,
      };
      const dates = estimateDates(r, signals);
      return {
        sheet_row: r.sheetRow,
        full_name: r.fullName,
        email: r.email,
        phone: r.phone,
        status: r.status,
        status_raw: r.statusRaw,
        monthly_price: r.monthlyPrice,
        started_at: dates.startedAt,
        started_at_source: dates.startedAtSource,
        cancelled_at: dates.cancelledAt,
        cancelled_at_source: dates.cancelledAtSource,
        user_id: userId,
        match_method: method,
        match_note: note,
      };
    });

    const { error: replaceError } = await admin.rpc("replace_student_subscriptions", { _rows: payload });
    if (replaceError) throw replaceError;

    const rowsMatched = payload.filter((p) => p.user_id).length;
    await finish({ ok: true, rows_total: payload.length, rows_matched: rowsMatched });
    await admin.from("subscription_sync_runs").delete()
      .lt("started_at", new Date(Date.now() - RUN_RETENTION_DAYS * 86_400_000).toISOString());

    return json({ ok: true, rows_total: payload.length, rows_matched: rowsMatched });
  } catch (e) {
    const message = (e as { message?: string })?.message ?? String(e);
    const code: ErrorCode = e instanceof HeaderNotFoundError ? "header_not_found"
      : e instanceof BridgeError ? "bridge_error"
      : "internal_error";
    console.error(`[sync-subscriptions-sheet] ${code}:`, message);
    // The admin-only run log gets the detail; the public response gets the code.
    await finish({ ok: false, error: `${code}: ${message}`.slice(0, 500) });
    return json({ ok: false, error: code });
  }
});
