// send-lifecycle-emails — the onboarding + win-back sweep.
//
// Triggered by pg_cron every 30 minutes via pg_net (see migration
// 20260823100000_lifecycle_emails.sql). Handles three mails:
//   welcome_6h   6h after signup
//   tips_48h     48h after signup
//   inactive_7d  7 days with no portal activity, once per absence
//
// Idempotency is the ledger's UNIQUE (user_id, kind, dedupe_key): we CLAIM a
// row before calling Resend, so two overlapping runs cannot double-send.
//
// Public (verify_jwt=false) because cron calls it unauthenticated. The only
// accepted body field is `dryRun` — nothing a caller sends can widen the
// audience or the time window, so an abusive caller can at worst trigger a
// send that was already due.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  selectRecipients, ledgerKey, INACTIVITY_DAYS,
  type LifecycleKind, type LifecycleCandidate,
} from "../_shared/lifecycle.ts";
import { renderLifecycleEmail } from "../_shared/lifecycle-templates.ts";

const RESEND_API = "https://api.resend.com/emails";
const FROM_EMAIL = Deno.env.get("ANNOUNCE_FROM_EMAIL") ?? Deno.env.get("INVITE_FROM_EMAIL")
  ?? "Hebreo y Adaptación <noreply@example.com>";
const SITE_URL = (Deno.env.get("INVITE_SITE_URL") ?? "https://app.rominahebreo.com").replace(/\/$/, "");
const REPLY_TO = Deno.env.get("INVITE_REPLY_TO") ?? null;

const KINDS: LifecycleKind[] = ["welcome_6h", "tips_48h", "inactive_7d"];

// Per-run ceilings. The win-back cap is deliberately low: on the first run it
// has the entire dormant back-catalogue to work through, and draining that over
// a few days protects the sending domain far better than one large burst.
const BATCH_CAP: Record<LifecycleKind, number> = {
  welcome_6h: 200,
  tips_48h: 200,
  inactive_7d: 50,
};

const DAY_MS = 86_400_000;

interface ProfileRow { id: string; email: string; full_name: string | null; created_at: string }

/** PostgREST caps `in.()` lists; keep each request comfortably under it. */
async function inChunks<T>(ids: string[], size: number, fn: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(...await fn(ids.slice(i, i + size)));
  return out;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const resendKey = Deno.env.get("RESEND_API_KEY");

    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dryRun === true;
    const now = new Date();

    const { data: settings } = await admin
      .from("tenant_settings").select("lifecycle_emails_start_at").maybeSingle();
    // No settings row yet => treat the feature as starting now, which suppresses
    // onboarding mail rather than mailing the back catalogue. That is the safe
    // direction, but it also means the onboarding mails silently never send, so
    // say so loudly in the response instead of failing quietly.
    const startAt = settings?.lifecycle_emails_start_at ?? now.toISOString();
    const startAtMissing = !settings?.lifecycle_emails_start_at;
    if (startAtMissing) {
      console.warn("tenant_settings.lifecycle_emails_start_at is unset — onboarding mail is suppressed.");
    }

    // Only students. Romina and the instructors must not receive "welcome to
    // the community" mail about their own portal.
    const { data: studentRoles, error: rolesErr } = await admin
      .from("user_roles").select("user_id").eq("role", "student");
    if (rolesErr) throw rolesErr;
    const studentIds = new Set((studentRoles ?? []).map((r) => r.user_id as string));

    const summary: Record<string, unknown> = { dryRun, now: now.toISOString(), kinds: {} };
    if (startAtMissing) summary.warning = "tenant_settings.lifecycle_emails_start_at is unset — onboarding mail suppressed";

    for (const kind of KINDS) {
      // -- Narrow the roster in SQL before the pure selector refines it -------
      let q = admin.from("profiles").select("id,email,full_name,created_at").is("deleted_at", null);
      if (kind === "inactive_7d") {
        // lastSeen >= created_at always, so a recent signup can never be lapsed.
        q = q.lte("created_at", new Date(now.getTime() - INACTIVITY_DAYS * DAY_MS).toISOString());
      } else {
        // Onboarding: only ever the last few days of signups.
        const graceDays = kind === "welcome_6h" ? 4 : 8;
        q = q.lte("created_at", now.toISOString())
             .gt("created_at", new Date(now.getTime() - graceDays * DAY_MS).toISOString());
      }
      const { data: profileRows, error: profErr } = await q;
      if (profErr) throw profErr;

      const profiles = (profileRows ?? []).filter((p) => studentIds.has(p.id) && p.email) as ProfileRow[];
      const ids = profiles.map((p) => p.id);
      if (!ids.length) { (summary.kinds as Record<string, unknown>)[kind] = { eligible: 0, sent: 0 }; continue; }

      const [activity, prefs, ledger] = await Promise.all([
        inChunks(ids, 200, async (c) => {
          const { data, error } = await admin.from("student_activity").select("user_id,last_active_at").in("user_id", c);
          if (error) throw error; return data ?? [];
        }),
        inChunks(ids, 200, async (c) => {
          const { data, error } = await admin
            .from("lifecycle_email_prefs").select("user_id,emails_enabled,unsubscribe_token").in("user_id", c);
          if (error) throw error; return data ?? [];
        }),
        inChunks(ids, 200, async (c) => {
          const { data, error } = await admin
            .from("lifecycle_email_sends").select("user_id,kind,dedupe_key").eq("kind", kind).in("user_id", c);
          if (error) throw error; return data ?? [];
        }),
      ]);

      const activeAt = new Map(activity.map((a) => [a.user_id as string, a.last_active_at as string]));
      const prefBy = new Map(prefs.map((p) => [p.user_id as string, p]));
      const alreadySent = new Set(
        ledger.map((l) => ledgerKey(l.user_id as string, l.kind as LifecycleKind, l.dedupe_key as string)),
      );

      const candidates: LifecycleCandidate[] = profiles.map((p) => ({
        userId: p.id,
        createdAt: p.created_at,
        lastActiveAt: activeAt.get(p.id) ?? null,
        emailsEnabled: prefBy.get(p.id)?.emails_enabled !== false,
      }));

      const selected = selectRecipients(kind, candidates, { now, startAt, alreadySent });
      const batch = selected.slice(0, BATCH_CAP[kind]);
      const deferred = selected.length - batch.length;

      const kindSummary: Record<string, unknown> = { eligible: selected.length, deferred, sent: 0, failed: 0 };
      (summary.kinds as Record<string, unknown>)[kind] = kindSummary;
      if (dryRun || !batch.length) continue;
      if (!resendKey) { kindSummary.error = "RESEND_API_KEY not set"; continue; }

      const profileBy = new Map(profiles.map((p) => [p.id, p]));

      for (const { candidate, dedupeKey } of batch) {
        const profile = profileBy.get(candidate.userId)!;

        // CLAIM FIRST. If a concurrent run already inserted this row the unique
        // index rejects us and we skip — that is the whole double-send defence.
        const { data: claim, error: claimErr } = await admin
          .from("lifecycle_email_sends")
          .insert({ user_id: candidate.userId, kind, dedupe_key: dedupeKey, email_status: "claimed" })
          .select("id").single();
        if (claimErr || !claim) continue;

        // Ensure the recipient has an unsubscribe capability to put in the mail.
        let token = prefBy.get(candidate.userId)?.unsubscribe_token as string | undefined;
        if (!token) {
          const { data: pref } = await admin
            .from("lifecycle_email_prefs")
            .upsert({ user_id: candidate.userId }, { onConflict: "user_id" })
            .select("unsubscribe_token").single();
          token = pref?.unsubscribe_token as string | undefined;
        }
        const unsubscribeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/lifecycle-unsubscribe?token=${token ?? ""}`;

        const mail = renderLifecycleEmail(kind, {
          fullName: profile.full_name,
          ctaUrl: `${SITE_URL}/dashboard`,
          unsubscribeUrl,
          contactUrl: REPLY_TO ? `mailto:${REPLY_TO}` : `${SITE_URL}/dashboard`,
        });

        try {
          const res = await fetch(RESEND_API, {
            method: "POST",
            headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: FROM_EMAIL,
              to: [profile.email],
              subject: mail.subject,
              html: mail.html,
              text: mail.text,
              ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
              headers: {
                "List-Unsubscribe": `<${unsubscribeUrl}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
            }),
          });
          const payload = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(payload?.message ?? `Resend ${res.status}`);

          await admin.from("lifecycle_email_sends")
            .update({ email_status: "sent", resend_id: payload?.id ?? null, sent_at: new Date().toISOString() })
            .eq("id", claim.id);
          kindSummary.sent = (kindSummary.sent as number) + 1;
        } catch (err) {
          // Leave the row behind as 'failed' — it keeps the unique slot, so a
          // retry is a deliberate act rather than an accidental second send.
          await admin.from("lifecycle_email_sends")
            .update({ email_status: "failed", error: String(err).slice(0, 500) })
            .eq("id", claim.id);
          kindSummary.failed = (kindSummary.failed as number) + 1;
        }
      }
    }

    return json({ ok: true, ...summary });
  } catch (err) {
    console.error("send-lifecycle-emails failed:", err);
    return json({ error: String(err) }, 500);
  }
});
