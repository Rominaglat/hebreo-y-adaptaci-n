// announce-course-content — "Publish & announce" for new course content.
//
// Called by a staff member (admin / super_admin / instructor) from the course
// editor. Creates ONE course-scoped in-portal announcement (visible only to
// enrolled students via RLS) and emails each enrolled student via Resend.
//
// Auth: caller must be admin / super_admin / instructor (user_roles).
// Body: { courseId: string, title: string, message: string }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const RESEND_API = "https://api.resend.com/emails";
const FROM_EMAIL = Deno.env.get("ANNOUNCE_FROM_EMAIL") ?? Deno.env.get("INVITE_FROM_EMAIL") ?? "Romina Hebreo <noreply@example.com>";
const SITE_URL = Deno.env.get("INVITE_SITE_URL") ?? "https://app.rominahebreo.com";
const REPLY_TO = Deno.env.get("INVITE_REPLY_TO") ?? null;

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function buildHtml(opts: { title: string; message: string; courseName: string; siteUrl: string }): string {
  const title = esc(opts.title);
  const message = esc(opts.message).replace(/\n/g, "<br>");
  const course = esc(opts.courseName);
  return `<!doctype html><html><body style="margin:0;background:#FBF4DE;font-family:system-ui,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:linear-gradient(135deg,#C4582A,#A14823);color:#FBF4DE;padding:18px 22px;border-radius:16px 16px 0 0;font-weight:800">🎓 Romina Hebreo</div>
    <div style="background:#fff;padding:24px;border-radius:0 0 16px 16px">
      <h1 style="margin:0 0 4px;font-size:20px;color:#2A2320">${title}</h1>
      ${course ? `<p style="margin:0 0 16px;font-size:13px;color:#8A7A6D">${course}</p>` : ""}
      <p style="font-size:15px;line-height:1.6;color:#3D2E26">${message}</p>
      <a href="${esc(opts.siteUrl)}" style="display:inline-block;margin-top:18px;background:#C4582A;color:#fff;font-weight:800;padding:12px 20px;border-radius:10px;text-decoration:none">Ir al curso →</a>
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
    const courseId = String(body.courseId ?? "");
    const title = String(body.title ?? "").trim();
    const message = String(body.message ?? "").trim();
    if (!courseId || !title || !message) return jsonResp({ error: "missing_fields" }, 400);

    const { data: course } = await admin.from("courses").select("title").eq("id", courseId).maybeSingle();

    // --- 1. course-scoped in-portal announcement ---
    const { error: annErr } = await admin.from("announcements").insert({
      author_id: user.id, title, content: message, course_id: courseId,
    });
    if (annErr) return jsonResp({ error: "announce_failed", detail: annErr.message }, 500);

    // --- 2. email enrolled students ---
    const { data: enrolls } = await admin.from("enrollments").select("user_id").eq("course_id", courseId);
    const userIds = [...new Set((enrolls ?? []).map((e) => e.user_id as string))];
    let emailed = 0;
    if (userIds.length && resendKey) {
      const { data: profiles } = await admin.from("profiles").select("email").in("id", userIds);
      const emails = (profiles ?? []).map((p) => p.email as string).filter(Boolean);
      const html = buildHtml({ title, message, courseName: course?.title ?? "", siteUrl: SITE_URL });
      for (const to of emails) {
        try {
          const resp = await fetch(RESEND_API, {
            method: "POST",
            headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from: FROM_EMAIL, to, subject: title, html, ...(REPLY_TO ? { reply_to: REPLY_TO } : {}) }),
          });
          if (resp.ok) emailed++;
        } catch (_) { /* per-recipient failure must not abort the run */ }
      }
    }

    return jsonResp({ announced: true, recipients: userIds.length, emailed });
  } catch (e) {
    return jsonResp({ error: "unexpected", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
