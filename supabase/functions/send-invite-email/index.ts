// send-invite-email — Resend-backed welcome email for newly invited users.
//
// Called from admin-user-actions.create_user after a user is successfully
// created. Sends a Hebrew HTML email with:
//   - A magic link (generateLink type=recovery, redirectTo=/accept-invite)
//     that signs the user in and prompts them to set their own password.
//   - A fallback section with the email + temp password in case the link
//     fails (some inbox providers rewrite links). The temp password is still
//     server-generated; the magic link is the primary path.
//
// Auth: caller must be admin, super_admin, or instructor via user_roles.
// Rate-limited per-caller (10/min) so a compromised admin can't spam.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

const RESEND_API = "https://api.resend.com/emails";
const FROM_EMAIL = Deno.env.get("INVITE_FROM_EMAIL") ?? "Learning Portal <noreply@example.com>";
const SITE_URL = Deno.env.get("INVITE_SITE_URL") ?? "https://app.example.com";
const REPLY_TO = Deno.env.get("INVITE_REPLY_TO") ?? null;
// Brand logo for the invite email. Set INVITE_LOGO_URL to a public PNG/SVG URL.
const DEFAULT_LOGO_URL = Deno.env.get("INVITE_LOGO_URL") ?? "";

// HTML escape — user-controlled values go through this before being embedded
// in the email body.
function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Light template per Learning Portal DESIGN-LANGUAGE.md. Inline CSS,
// MSO-wrapped CTA, RTL Hebrew. Brand colors: #712FF1 violet → #DC1FFF magenta.
// Layout iterations in docs/email-templates/invite-preview.html (review there
// before changing this).
function buildHtml(opts: {
  fullName: string;
  tenantName: string;
  logoUrl: string;
  magicLink: string;
  email: string;
  tempPassword: string;
  loginUrl: string;
  year: number;
}): string {
  const name = esc(opts.fullName || "👋");
  const tenant = esc(opts.tenantName);
  const logo = esc(opts.logoUrl);
  const link = opts.magicLink; // URL — already encoded by Supabase
  const linkEsc = esc(link);
  const emailEsc = esc(opts.email);
  const tempEsc = esc(opts.tempPassword);
  const loginUrl = esc(opts.loginUrl);

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta name="x-apple-disable-message-reformatting">
<title>הזמנה לפורטל ${tenant}</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
<style>
  @media (max-width:620px){
    .container{width:100%!important;}
    .px-40{padding-left:24px!important;padding-right:24px!important;}
    .py-hero{padding-top:36px!important;padding-bottom:24px!important;}
    .h1{font-size:28px!important;line-height:1.2!important;}
    .lead{font-size:16px!important;}
    .cta-btn{font-size:16px!important;padding:15px 32px!important;}
    .logo-lg{width:140px!important;height:auto!important;}
  }
  a{color:#712FF1;text-decoration:none;}
  a:hover{text-decoration:underline;}
  @media (prefers-color-scheme: dark){
    .card{background:#FEFBFF!important;}
    .body-text{color:#0A0820!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:#F3F0FA;font-family:'Heebo','Assistant','Noto Sans Hebrew','Segoe UI',-apple-system,BlinkMacSystemFont,Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">

<!-- pre-header -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#F3F0FA;opacity:0;">
  המשתמש שלך לפורטל הקורסים מוכן. הגדרת סיסמה אישית לוקחת פחות מדקה.
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F3F0FA;">
  <tr>
    <td align="center" style="padding:32px 12px;">

      <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0"
             style="width:600px;max-width:600px;background:#FEFBFF;border-radius:24px;overflow:hidden;
                    box-shadow:0 20px 60px rgba(75,32,130,0.12);">

        <!-- HERO with centered logo on gradient -->
        <tr>
          <td style="background:linear-gradient(288deg,#DC1FFF 0%,#712FF1 60%,#4B2082 100%);padding:44px 40px 36px;text-align:center;position:relative;">
            <div style="position:absolute;top:-40px;left:-40px;width:160px;height:160px;border-radius:50%;background:radial-gradient(circle,rgba(220,31,255,0.4) 0%,transparent 70%);"></div>
            <div style="position:absolute;bottom:-30px;right:-30px;width:120px;height:120px;border-radius:50%;background:radial-gradient(circle,rgba(113,47,241,0.35) 0%,transparent 70%);"></div>

            <img src="${logo}"
                 alt="${tenant}"
                 class="logo-lg"
                 width="240" height="135"
                 style="display:block;margin:0 auto;border:0;outline:none;max-width:240px;height:auto;">
          </td>
        </tr>

        <!-- TITLE -->
        <tr>
          <td class="px-40 py-hero" style="padding:52px 40px 24px;text-align:right;">
            <h1 class="h1" style="margin:0 0 18px;font-size:36px;line-height:1.15;font-weight:800;
                                   color:#0A0820;letter-spacing:-0.5px;font-family:'Heebo','Assistant',sans-serif;">
              ברוך הבא לפורטל
              <br>
              <span style="background:linear-gradient(90deg,#712FF1 0%,#DC1FFF 100%);
                           -webkit-background-clip:text;background-clip:text;color:#DC1FFF;
                           -webkit-text-fill-color:transparent;">${tenant}</span>
            </h1>

            <p class="lead body-text" style="margin:0;font-size:18px;line-height:1.6;color:#555555;font-weight:400;">
              שלום <strong style="color:#0A0820;font-weight:700;">${name}</strong>, נוצר עבורך חשבון חדש. הגדרת סיסמה אישית והכניסה לפורטל לוקחים פחות מדקה.
            </p>
          </td>
        </tr>

        <!-- PRIMARY CTA -->
        <tr>
          <td class="px-40" style="padding:8px 40px 16px;text-align:center;">
            <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                           href="${linkEsc}"
                           style="height:56px;v-text-anchor:middle;width:320px;" arcsize="100%"
                           stroke="f" fillcolor="#712FF1">
                <w:anchorlock/>
                <center style="color:#FFFFFF;font-family:Arial,sans-serif;font-size:18px;font-weight:700;">הגדרת סיסמה והכניסה</center>
              </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-- -->
            <a href="${linkEsc}"
               class="cta-btn"
               style="display:inline-block;
                      background:linear-gradient(180deg,#712FF1 0%,#DC1FFF 100%);
                      color:#FFFFFF;font-size:18px;font-weight:700;
                      padding:17px 40px;border-radius:50px;
                      text-decoration:none;
                      box-shadow:0 12px 30px rgba(220,31,255,0.35),0 0 0 1px rgba(255,255,255,0.4) inset;
                      font-family:'Heebo','Assistant',sans-serif;
                      letter-spacing:-0.1px;">
              הגדרת סיסמה והכניסה
            </a>
            <!--<![endif]-->
            <p style="margin:14px 0 0;font-size:13px;color:#777777;font-family:inherit;">
              קישור חד-פעמי · תוקף 24 שעות
            </p>
          </td>
        </tr>

        <!-- DIVIDER -->
        <tr>
          <td style="padding:32px 40px 12px;">
            <div style="height:1px;background:linear-gradient(90deg,transparent 0%,#E8E6F0 50%,transparent 100%);"></div>
          </td>
        </tr>

        <!-- FALLBACK CREDS -->
        <tr>
          <td class="px-40" style="padding:12px 40px 20px;text-align:right;">
            <p style="margin:0 0 12px;font-size:13px;font-weight:600;color:#777777;font-family:inherit;">
              קישור לא נטען? אפשר להיכנס ידנית
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                   style="background:#FAFAFC;border:1px solid #EAE6F0;border-radius:12px;">
              <tr>
                <td style="padding:16px 18px;font-size:13px;color:#555555;line-height:1.9;font-family:inherit;">
                  <strong style="color:#0A0820;display:inline-block;width:54px;">כניסה:</strong>
                  <a href="${loginUrl}" style="color:#712FF1;direction:ltr;display:inline-block;">${loginUrl}</a>
                  <br>
                  <strong style="color:#0A0820;display:inline-block;width:54px;">דוא"ל:</strong>
                  <code style="direction:ltr;display:inline-block;background:#FFFFFF;padding:2px 8px;border-radius:5px;border:1px solid #EAE6F0;font-size:12px;font-family:Menlo,Consolas,monospace;color:#0A0820;">${emailEsc}</code>
                  <br>
                  <strong style="color:#0A0820;display:inline-block;width:54px;">סיסמה:</strong>
                  <code style="direction:ltr;display:inline-block;background:#FFFFFF;padding:2px 8px;border-radius:5px;border:1px solid #EAE6F0;font-size:12px;font-family:Menlo,Consolas,monospace;color:#0A0820;">${tempEsc}</code>
                  <span style="font-size:11px;color:#999999;margin-right:8px;">(להחליף מיד)</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- SIGN-OFF -->
        <tr>
          <td class="px-40" style="padding:24px 40px 28px;text-align:right;">
            <p style="margin:0 0 4px;font-size:15px;color:#1F2124;font-family:inherit;line-height:1.5;">
              נתראה בפנים,
            </p>
            <p style="margin:0;font-size:15px;color:#0A0820;font-weight:700;font-family:inherit;">
              צוות ${tenant}
            </p>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="padding:24px 40px 28px;background:#F7F3FF;text-align:center;border-top:1px solid #EAE6F0;">
            <p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:#777777;font-family:inherit;">
              © ${opts.year} ${tenant} · פורטל הלמידה
            </p>
            <p style="margin:0;font-size:11px;line-height:1.6;color:#999999;font-family:inherit;">
              לא יזמת/ה את ההזמנה הזו? אפשר להתעלם — אף שינוי לא בוצע.
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function buildText(opts: {
  fullName: string;
  tenantName: string;
  magicLink: string;
  email: string;
  tempPassword: string;
  loginUrl: string;
}): string {
  return [
    `שלום ${opts.fullName},`,
    "",
    `הצטרפת ל-${opts.tenantName} — פורטל הלמידה.`,
    "המשתמש שלך נוצר. להגדרת סיסמה אישית והכניסה:",
    opts.magicLink,
    "",
    "הקישור תקף ל-24 שעות.",
    "",
    "גיבוי — אם הקישור לא נטען:",
    `דוא"ל: ${opts.email}`,
    `סיסמה זמנית: ${opts.tempPassword}`,
    `כניסה ידנית: ${opts.loginUrl}`,
    "",
    "מומלץ להחליף את הסיסמה הזמנית מיד אחרי ההתחברות.",
  ].join("\n");
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const jsonResp = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");

    if (!resendKey) {
      console.error("[send-invite-email] RESEND_API_KEY not configured");
      return jsonResp({ error: "email_not_configured" }, 500);
    }

    // Caller must be authenticated admin/super_admin (or instructor — they
    // can create student users per existing admin-user-actions rules; same
    // restrictions apply here).
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return jsonResp({ error: "Unauthorized" }, 401);
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResp({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);

    // Per-caller rate limit (10/min) so a stolen admin token can't blast.
    const rl = await checkRateLimit(admin, `send-invite-email:${user.id}`, 10);
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: "rate_limit" }), {
        status: 429,
        headers: { ...corsHeaders, ...rl.headers, "Content-Type": "application/json" },
      });
    }

    const { data: callerRoles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["admin", "super_admin", "instructor"]);
    if (!callerRoles || callerRoles.length === 0) {
      return jsonResp({ error: "Forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({})) as {
      email?: string;
      fullName?: string;
      tempPassword?: string;
    };

    const email = String(body.email ?? "").trim().toLowerCase();
    const fullName = String(body.fullName ?? "").trim();
    const tempPassword = String(body.tempPassword ?? "").trim();

    if (!email || !email.includes("@") || !fullName || !tempPassword) {
      return jsonResp({ error: "invalid_input" }, 400);
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return jsonResp({ error: "invalid_email" }, 400);
    }

    // Single-tenant build: hard-coded brand name and default logo. If a
    // future settings table reintroduces a per-deploy logo override, plug
    // it back in here.
    const tenantName = "Learning Portal";
    const logoUrl = DEFAULT_LOGO_URL;

    // Generate the magic link via Supabase Auth admin API. type=recovery
    // lands the user on /accept-invite with a fresh session and prompts a
    // password change. The link is single-use and expires in 24h.
    const redirectTo = `${SITE_URL}/accept-invite`;
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });
    if (linkError || !linkData?.properties?.action_link) {
      console.error("[send-invite-email] generateLink failed:", linkError);
      return jsonResp({ error: "link_failed" }, 500);
    }
    const magicLink = linkData.properties.action_link;

    // Render + send via Resend.
    const loginUrl = `${SITE_URL}/login`;
    const year = new Date().getFullYear();
    const html = buildHtml({
      fullName,
      tenantName,
      logoUrl,
      magicLink,
      email,
      tempPassword,
      loginUrl,
      year,
    });
    const text = buildText({ fullName, tenantName, magicLink, email, tempPassword, loginUrl });

    const resendPayload: Record<string, unknown> = {
      from: FROM_EMAIL,
      to: [email],
      subject: `הצטרפת ל-${tenantName} — הגדרת סיסמה והכניסה לפורטל`,
      html,
      text,
    };
    if (REPLY_TO) resendPayload.reply_to = REPLY_TO;

    const resendResp = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendPayload),
    });
    if (!resendResp.ok) {
      const errText = await resendResp.text();
      console.error(`[send-invite-email] Resend ${resendResp.status}: ${errText.slice(0, 300)}`);
      // Don't echo Resend's error verbatim to the caller (defense in depth).
      return jsonResp({ error: "send_failed", status: resendResp.status }, 502);
    }
    const sendResult = await resendResp.json() as { id?: string };

    // Audit-log the dispatch.
    try {
      await admin.from("auth_audit_log").insert({
        actor_id: user.id,
        target_user_id: null,
        action: "send_invite_email",
        before: null,
        after: { email_resend_id: sendResult.id ?? null },
        ip: req.headers.get("x-forwarded-for") || null,
        user_agent: req.headers.get("user-agent") || null,
      });
    } catch (e) {
      console.error("[send-invite-email] audit log write failed:", e);
    }

    return jsonResp({ ok: true, id: sendResult.id ?? null });
  } catch (e) {
    console.error("[send-invite-email] error:", e);
    return jsonResp({ error: "internal_error" }, 500);
  }
});
