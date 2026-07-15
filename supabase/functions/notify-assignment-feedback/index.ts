// notify-assignment-feedback — when a teacher leaves feedback on an assignment
// submission, notify the student: a personal in-portal announcement + a Resend
// email (Spanish).
//
// Auth: caller must be admin / super_admin / instructor (user_roles).
// Body: { submissionId: string }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const RESEND_API = "https://api.resend.com/emails";
const FROM_EMAIL = Deno.env.get("ANNOUNCE_FROM_EMAIL") ?? Deno.env.get("INVITE_FROM_EMAIL") ?? "Romina Hebreo <noreply@example.com>";
const SITE_URL = (Deno.env.get("INVITE_SITE_URL") ?? "https://app.rominahebreo.com").replace(/\/$/, "");
const REPLY_TO = Deno.env.get("INVITE_REPLY_TO") ?? null;

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function buildHtml(opts: { name: string; lessonTitle: string; feedback: string; ctaUrl: string }): string {
  const name = esc(opts.name || "");
  const lesson = esc(opts.lessonTitle);
  const feedback = esc(opts.feedback).replace(/\n/g, "<br>");
  return `<!doctype html><html><body style="margin:0;background:#FBF4DE;font-family:system-ui,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:linear-gradient(135deg,#C4582A,#A14823);color:#FBF4DE;padding:18px 22px;border-radius:16px 16px 0 0;font-weight:800">🎓 Romina Hebreo</div>
    <div style="background:#fff;padding:24px;border-radius:0 0 16px 16px">
      <p style="font-size:18px;font-weight:700;color:#2A2320;margin:0 0 4px">¡Hola, ${name}! 👋</p>
      <p style="font-size:14px;color:#8A7A6D;margin:0 0 16px">Tu profesor dejó comentarios en tu trabajo: <b>${lesson}</b></p>
      <div style="font-size:15px;line-height:1.6;color:#3D2E26;background:#FBF7EE;border-left:3px solid #C4582A;padding:12px 14px;border-radius:8px;white-space:pre-wrap">${feedback}</div>
      <a href="${esc(opts.ctaUrl)}" style="display:inline-block;margin-top:18px;background:#C4582A;color:#fff;font-weight:800;padding:12px 20px;border-radius:10px;text-decoration:none">Ver mi trabajo →</a>
    </div>
  </div></body></html>`;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const jsonResp = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");

    // --- auth: caller must be staff ---
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) return jsonResp({ error: "unauthorized" }, 401);
    const admin = createClient(supabaseUrl, serviceKey);
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return jsonResp({ error: "unauthorized" }, 401);
    const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", user.id);
    const isStaff = (roleRows ?? []).some((r) => ["admin", "super_admin", "instructor"].includes(r.role as string));
    if (!isStaff) return jsonResp({ error: "forbidden" }, 403);

    // --- input ---
    const body = await req.json().catch(() => ({}));
    const submissionId = String(body.submissionId ?? "");
    if (!submissionId) return jsonResp({ error: "missing_submissionId" }, 400);

    const { data: sub } = await admin
      .from("assignment_submissions")
      .select("user_id, lesson_id, feedback_text, lessons(title, module_id)")
      .eq("id", submissionId).maybeSingle();
    if (!sub) return jsonResp({ error: "submission_not_found" }, 404);

    const lessonRel = Array.isArray((sub as { lessons: unknown }).lessons)
      ? (sub as { lessons: { title: string; module_id: string }[] }).lessons[0]
      : (sub as { lessons: { title: string; module_id: string } | null }).lessons;
    const lessonTitle = lessonRel?.title ?? "";
    const studentId = (sub as { user_id: string }).user_id;
    const feedback = (sub as { feedback_text: string | null }).feedback_text ?? "";

    // resolve the course for a deep-link CTA (lesson -> module -> course)
    let courseId: string | null = null;
    if (lessonRel?.module_id) {
      const { data: mod } = await admin.from("modules").select("course_id").eq("id", lessonRel.module_id).maybeSingle();
      courseId = (mod as { course_id: string } | null)?.course_id ?? null;
    }
    const ctaUrl = courseId ? `${SITE_URL}/courses/${courseId}` : SITE_URL;

    // --- 1. personal in-portal announcement ---
    await admin.from("announcements").insert({
      author_id: user.id,
      user_id: studentId,
      title: lessonTitle ? `Comentarios en: ${lessonTitle}` : "Tienes comentarios en tu trabajo",
      content: feedback || "Tu profesor dejó comentarios en tu trabajo.",
    });

    // --- 2. email the student ---
    let emailed = false;
    if (resendKey) {
      const { data: profile } = await admin.from("profiles").select("email, full_name").eq("id", studentId).maybeSingle();
      const p = profile as { email: string | null; full_name: string | null } | null;
      if (p?.email) {
        try {
          const resp = await fetch(RESEND_API, {
            method: "POST",
            headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: FROM_EMAIL, to: p.email,
              subject: "Tienes comentarios en tu trabajo 📝",
              html: buildHtml({ name: p.full_name?.split(" ")[0] ?? "", lessonTitle, feedback, ctaUrl }),
              ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
            }),
          });
          emailed = resp.ok;
        } catch (_) { /* email failure must not fail the request */ }
      }
    }

    return jsonResp({ notified: true, emailed });
  } catch (e) {
    return jsonResp({ error: "unexpected", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
