// send-weekly-goal-summary — weekly progress email for students with a goal.
//
// Triggered by pg_cron (Mon 08:00) via pg_net, or manually. Idempotent: one
// snapshot row per (user, week_start) — a second invocation never double-sends.
// Body (optional): { "dryRun": true, "weekStart": "YYYY-MM-DD" } for testing.
//
// Emails are Spanish (the audience). Public function (verify_jwt=false); abuse
// impact is nil because the send is idempotent per week.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const RESEND_API = "https://api.resend.com/emails";
const FROM_EMAIL = Deno.env.get("ANNOUNCE_FROM_EMAIL") ?? Deno.env.get("INVITE_FROM_EMAIL") ?? "Romina Hebreo <noreply@example.com>";
const SITE_URL = (Deno.env.get("INVITE_SITE_URL") ?? "https://app.rominahebreo.com").replace(/\/$/, "");
const REPLY_TO = Deno.env.get("INVITE_REPLY_TO") ?? null;
const DEFAULT_LESSON_MINUTES = 30;

type Tier = "exceeded" | "met" | "close" | "behind" | "inactive";

function tierFor(pct: number): Tier {
  if (pct <= 0) return "inactive";
  if (pct >= 1.2) return "exceeded";
  if (pct >= 1) return "met";
  if (pct >= 0.7) return "close";
  return "behind";
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Monday (UTC) of the week that just ended, relative to `now`.
function lastWeekStart(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday - 7);
  return d;
}

const TIER_COPY: Record<Tier, { subject: (n: string) => string; msg: string }> = {
  exceeded: { subject: (n) => `¡Superaste tu meta esta semana, ${n}! 🏆`, msg: "¡Increíble! Fuiste más allá de tu meta. Esta constancia es justo lo que construye el dominio del idioma. 🔥" },
  met: { subject: (n) => `🎯 ¡Cumpliste tu meta, ${n}!`, msg: "¡Felicidades! Diste justo en el blanco esta semana. Sigue así. 🔥" },
  close: { subject: (n) => `¡Muy cerca, ${n}! Te faltó poquito 🔥`, msg: "Estuviste a nada de tu meta. Un pequeño empujón esta semana y lo logras. 💪" },
  behind: { subject: (n) => `Volvamos al camino esta semana, ${n} 💪`, msg: "Una semana ocupada le pasa a cualquiera. Lo importante es volver — incluso una sola lección hoy te reencamina. Estás más cerca de lo que crees. 🧡" },
  inactive: { subject: (n) => `Te extrañamos, ${n} — una lección y empiezas 🌱`, msg: "Esta semana no registramos actividad. No pasa nada: una sola lección hoy arranca de nuevo tu racha. 🌱" },
};

function buildEmail(opts: {
  name: string; unit: string; target: number; hoursDone: number; lessonsDone: number;
  actual: number; pct: number; tier: Tier; streakWeeks: number; trend: number | null;
  ctaUrl: string; unsubscribeUrl: string;
}): { subject: string; html: string } {
  const copy = TIER_COPY[opts.tier];
  const name = esc(opts.name || "");
  const isHours = opts.unit === "hours";
  const doneStr = isHours ? (opts.hoursDone % 1 ? opts.hoursDone.toFixed(1) : String(opts.hoursDone)) : String(opts.lessonsDone);
  const unitLabel = isHours ? "h" : "lecciones";
  const barPct = Math.max(2, Math.min(100, Math.round(opts.pct * 100)));
  const streakRow = opts.streakWeeks > 0
    ? `<div style="font-size:14px;color:#3D2E26;margin:8px 0">🔥 <b>${opts.streakWeeks} ${opts.streakWeeks === 1 ? "semana" : "semanas"} seguidas</b> cumpliendo tu meta</div>` : "";
  const trendRow = (opts.trend != null && opts.trend !== 0)
    ? `<div style="font-size:14px;color:#3D2E26;margin:8px 0">${opts.trend > 0 ? "↑" : "↓"} ${Math.abs(opts.trend)} ${isHours ? "h" : "lecciones"} ${opts.trend > 0 ? "más" : "menos"} que la semana pasada</div>` : "";

  const html = `<!doctype html><html><body style="margin:0;background:#FBF4DE;font-family:system-ui,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:linear-gradient(135deg,#C4582A,#A14823);color:#FBF4DE;padding:18px 22px;border-radius:16px 16px 0 0;font-weight:800">🎓 Romina Hebreo</div>
    <div style="background:#fff;padding:24px;border-radius:0 0 16px 16px">
      <p style="font-size:18px;font-weight:700;color:#2A2320;margin:0 0 12px">¡Hola, ${name}! 👋</p>
      <p style="font-size:26px;font-weight:800;color:#2A2320;margin:0">${esc(doneStr)} <span style="font-size:15px;font-weight:600;color:#8A7A6D">/ ${esc(String(opts.target))} ${esc(unitLabel)}</span></p>
      <div style="height:12px;border-radius:999px;background:#F1E7D6;overflow:hidden;margin:12px 0 6px">
        <div style="height:100%;width:${barPct}%;border-radius:999px;background:linear-gradient(90deg,#C4582A,#E0864F)"></div>
      </div>
      <div style="font-size:12px;color:#8A7A6D">${Math.round(opts.pct * 100)}% de tu meta semanal · ${opts.lessonsDone} lecciones completadas</div>
      <div style="font-size:14px;line-height:1.55;color:#3D2E26;background:#FBF7EE;border-left:3px solid #C4582A;padding:10px 12px;border-radius:8px;margin:16px 0">${copy.msg}</div>
      ${streakRow}${trendRow}
      <a href="${esc(opts.ctaUrl)}" style="display:inline-block;margin-top:14px;background:#C4582A;color:#fff;font-weight:800;padding:13px 22px;border-radius:12px;text-decoration:none">Continuar aprendiendo →</a>
    </div>
    <div style="text-align:center;font-size:11px;color:#9a8b7d;padding:14px;line-height:1.7">
      Recibes este correo porque definiste una meta semanal.<br>
      <a href="${esc(opts.unsubscribeUrl)}" style="color:#9a8b7d">Darse de baja</a>
    </div>
  </div></body></html>`;

  return { subject: copy.subject(name), html };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const jsonResp = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dryRun === true;
    const now = new Date();
    // SECURITY: weekStart is NOT read from the request. This function is public
    // (cron-triggered), so a caller-supplied week would let an attacker fabricate
    // unlimited distinct weeks and generate unbounded emails — the per-(user,week)
    // idempotency only protects a *fixed* week. Always the last completed week, so
    // at most one (benign, real) send can be triggered per calendar week.
    const weekStartDate = lastWeekStart(now);
    const weekStart = ymd(weekStartDate);
    const weekEnd = new Date(weekStartDate); weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

    const [{ data: settings }, { data: goals }] = await Promise.all([
      admin.from("tenant_settings").select("default_lesson_minutes").maybeSingle(),
      admin.from("student_goals").select("user_id, unit, target, unsubscribe_token").eq("emails_enabled", true),
    ]);
    const defMin = (settings as { default_lesson_minutes?: number } | null)?.default_lesson_minutes ?? DEFAULT_LESSON_MINUTES;
    const goalRows = (goals ?? []) as { user_id: string; unit: string; target: number; unsubscribe_token: string }[];
    if (goalRows.length === 0) return jsonResp({ week_start: weekStart, considered: 0, sent: 0, skipped: 0 });

    const userIds = goalRows.map((g) => g.user_id);

    const [{ data: expired }, { data: doneSnaps }, { data: profiles }, { data: completions }, { data: enrolls }, { data: priorSnaps }] = await Promise.all([
      admin.from("access_limits").select("user_id").lte("expires_at", now.toISOString()),
      admin.from("weekly_goal_snapshots").select("user_id").eq("week_start", weekStart),
      admin.from("profiles").select("id, email, full_name").in("id", userIds),
      admin.from("lesson_completions").select("user_id, lessons(duration_minutes)").in("user_id", userIds).gte("completed_at", weekStartDate.toISOString()).lt("completed_at", weekEnd.toISOString()),
      admin.from("enrollments").select("user_id, course_id, progress_percentage").in("user_id", userIds),
      admin.from("weekly_goal_snapshots").select("user_id, week_start, tier, hours_done, lessons_done").in("user_id", userIds).lt("week_start", weekStart).order("week_start", { ascending: false }),
    ]);

    const expiredSet = new Set(((expired ?? []) as { user_id: string }[]).map((r) => r.user_id));
    const alreadySent = new Set(((doneSnaps ?? []) as { user_id: string }[]).map((r) => r.user_id));
    const profileById = new Map(((profiles ?? []) as { id: string; email: string; full_name: string }[]).map((p) => [p.id, p]));

    // minutes + lesson count per user for the week
    const agg = new Map<string, { lessons: number; minutes: number }>();
    for (const c of (completions ?? []) as { user_id: string; lessons: { duration_minutes: number | null } | { duration_minutes: number | null }[] | null }[]) {
      const rel = Array.isArray(c.lessons) ? c.lessons[0] : c.lessons;
      const dur = rel?.duration_minutes ?? defMin;
      const cur = agg.get(c.user_id) ?? { lessons: 0, minutes: 0 };
      cur.lessons += 1; cur.minutes += dur; agg.set(c.user_id, cur);
    }

    // active course (lowest progress < 100) per user, for the CTA
    const ctaCourse = new Map<string, string>();
    for (const e of (enrolls ?? []) as { user_id: string; course_id: string; progress_percentage: number }[]) {
      if (e.progress_percentage >= 100) continue;
      const cur = ctaCourse.get(e.user_id);
      if (!cur) ctaCourse.set(e.user_id, e.course_id);
    }

    // prior snapshots grouped by user (already sorted desc)
    const priorByUser = new Map<string, { week_start: string; tier: string; hours_done: number; lessons_done: number }[]>();
    for (const s of (priorSnaps ?? []) as { user_id: string; week_start: string; tier: string; hours_done: number; lessons_done: number }[]) {
      const arr = priorByUser.get(s.user_id) ?? []; arr.push(s); priorByUser.set(s.user_id, arr);
    }

    let sent = 0, skipped = 0, wouldSend = 0;
    const tierCounts: Record<string, number> = {};

    for (const g of goalRows) {
      if (expiredSet.has(g.user_id) || alreadySent.has(g.user_id)) { skipped++; continue; }
      const profile = profileById.get(g.user_id);
      if (!profile?.email) { skipped++; continue; }

      const a = agg.get(g.user_id) ?? { lessons: 0, minutes: 0 };
      const hoursDone = a.minutes / 60;
      const actual = g.unit === "hours" ? hoursDone : a.lessons;
      const pct = g.target > 0 ? actual / g.target : 0;
      const tier = tierFor(pct);

      // streak: consecutive immediately-preceding weeks that were met/exceeded
      const prior = priorByUser.get(g.user_id) ?? [];
      let streakWeeks = 0;
      const expectPrev = new Date(weekStartDate);
      for (const s of prior) {
        expectPrev.setUTCDate(expectPrev.getUTCDate() - 7);
        if (s.week_start === ymd(expectPrev) && (s.tier === "met" || s.tier === "exceeded")) streakWeeks++;
        else break;
      }
      if (tier === "met" || tier === "exceeded") streakWeeks += 1;

      // trend vs the immediately prior week
      const prevWeek = new Date(weekStartDate); prevWeek.setUTCDate(prevWeek.getUTCDate() - 7);
      const prevSnap = prior.find((s) => s.week_start === ymd(prevWeek));
      const trend = prevSnap ? (g.unit === "hours" ? Math.round((hoursDone - prevSnap.hours_done) * 10) / 10 : a.lessons - prevSnap.lessons_done) : null;

      const courseId = ctaCourse.get(g.user_id);
      const ctaUrl = courseId ? `${SITE_URL}/courses/${courseId}` : SITE_URL;
      const unsubscribeUrl = `${supabaseUrl}/functions/v1/goal-unsubscribe?token=${g.unsubscribe_token}`;

      const { subject, html } = buildEmail({
        name: profile.full_name?.split(" ")[0] ?? "", unit: g.unit, target: g.target,
        hoursDone, lessonsDone: a.lessons, actual, pct, tier, streakWeeks, trend, ctaUrl, unsubscribeUrl,
      });

      // dryRun returns ONLY aggregate counts — never per-user emails/ids (info leak).
      if (dryRun) { tierCounts[tier] = (tierCounts[tier] ?? 0) + 1; wouldSend++; continue; }

      let resendId: string | null = null, emailStatus = "skipped_no_key";
      if (resendKey) {
        try {
          const resp = await fetch(RESEND_API, {
            method: "POST",
            headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: FROM_EMAIL, to: profile.email, subject, html,
              ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
              // RFC 8058 one-click unsubscribe — compliant clients POST here.
              headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
            }),
          });
          emailStatus = resp.ok ? "sent" : `error_${resp.status}`;
          if (resp.ok) { resendId = (await resp.json())?.id ?? null; sent++; }
        } catch (_) { emailStatus = "error_exception"; }
      }

      await admin.from("weekly_goal_snapshots").insert({
        user_id: g.user_id, week_start: weekStart, unit: g.unit, target: g.target,
        lessons_done: a.lessons, minutes_done: a.minutes, hours_done: hoursDone,
        pct, tier, sent_at: new Date().toISOString(), resend_id: resendId, email_status: emailStatus,
      });
    }

    return jsonResp({ week_start: weekStart, considered: goalRows.length, sent, skipped, ...(dryRun ? { dryRun: true, wouldSend, tierCounts } : {}) });
  } catch (e) {
    return jsonResp({ error: "unexpected", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
