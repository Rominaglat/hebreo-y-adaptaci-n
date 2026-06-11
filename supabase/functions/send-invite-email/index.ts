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

// Hebreo y Adaptación brand: #C4582A (terracotta), #FBF4DE (cream),
// #1E40AF (deep blue accent). LTR Spanish. Logo is the H&A monogram
// rendered as styled text so every email client shows it (SVG support is
// inconsistent in Gmail / Outlook).
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
  const name = esc(opts.fullName || "");
  const tenant = esc(opts.tenantName);
  const linkEsc = esc(opts.magicLink);
  const emailEsc = esc(opts.email);
  const tempEsc = esc(opts.tempPassword);
  const loginUrl = esc(opts.loginUrl);

  // Use the configured logo URL if available; otherwise render an inline
  // monogram. (Most clients still strip SVG from <img>, so the text logo
  // doubles as a guaranteed fallback either way.)
  const logoBlock = opts.logoUrl
    ? `<img src="${esc(opts.logoUrl)}" alt="${tenant}" width="84" height="84"
            style="display:block;margin:0 auto 14px;border-radius:18px;border:0;outline:none;">`
    : `<div style="display:inline-block;width:84px;height:84px;border-radius:18px;
                    background:linear-gradient(135deg,#C4582A 0%,#A24818 100%);
                    box-shadow:0 14px 36px rgba(196,88,42,0.35);
                    font-family:Georgia,'Times New Roman',Times,serif;
                    text-align:center;line-height:84px;color:#FBF4DE;
                    font-size:38px;font-weight:700;letter-spacing:0.5px;">
         H<span style="color:#1E40AF;font-size:28px;font-weight:400;">&amp;</span>A
       </div>`;

  return `<!doctype html>
<html lang="es" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta name="x-apple-disable-message-reformatting">
<title>Bienvenida a ${tenant}</title>
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
  }
  a{color:#C4582A;text-decoration:none;}
  a:hover{text-decoration:underline;}
</style>
</head>
<body style="margin:0;padding:0;background:#FBF4DE;font-family:Georgia,'Times New Roman',Times,'Segoe UI',-apple-system,BlinkMacSystemFont,Arial,serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">

<!-- pre-header -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#FBF4DE;opacity:0;">
  Tu cuenta en ${tenant} está lista. Configura tu contraseña en menos de un minuto.
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FBF4DE;">
  <tr>
    <td align="center" style="padding:32px 12px;">

      <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0"
             style="width:600px;max-width:600px;background:#FFFFFF;border-radius:24px;overflow:hidden;
                    box-shadow:0 20px 60px rgba(196,88,42,0.18);">

        <!-- HERO with logo on warm gradient -->
        <tr>
          <td style="background:linear-gradient(135deg,#F5C99A 0%,#E89A5E 55%,#C4582A 100%);padding:48px 40px 40px;text-align:center;position:relative;">
            <div style="position:absolute;top:-40px;right:-40px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,0.30) 0%,transparent 70%);"></div>
            <div style="position:absolute;bottom:-30px;left:-30px;width:140px;height:140px;border-radius:50%;background:radial-gradient(circle,rgba(30,64,175,0.18) 0%,transparent 70%);"></div>

            ${logoBlock}
            <p style="margin:0;color:#FBF4DE;font-size:14px;font-weight:600;letter-spacing:2px;text-transform:uppercase;font-family:Georgia,serif;">
              ${tenant}
            </p>
          </td>
        </tr>

        <!-- TITLE -->
        <tr>
          <td class="px-40 py-hero" style="padding:48px 40px 20px;text-align:left;">
            <h1 class="h1" style="margin:0 0 18px;font-size:32px;line-height:1.2;font-weight:700;
                                   color:#1F2937;letter-spacing:-0.4px;font-family:Georgia,serif;">
              ¡Bienvenida${name ? ", " : ""}<span style="color:#C4582A;">${name}</span>!
            </h1>

            <p class="lead" style="margin:0 0 8px;font-size:17px;line-height:1.65;color:#4B5563;font-weight:400;">
              Te damos la bienvenida a <strong style="color:#1F2937;">${tenant}</strong>, la plataforma de aprendizaje de hebreo de Romina Glatstein.
            </p>
            <p class="lead" style="margin:0;font-size:17px;line-height:1.65;color:#4B5563;font-weight:400;">
              Tu cuenta está lista. Configura tu contraseña personal e ingresa en menos de un minuto.
            </p>
          </td>
        </tr>

        <!-- PRIMARY CTA -->
        <tr>
          <td class="px-40" style="padding:8px 40px 16px;text-align:center;">
            <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                           href="${linkEsc}"
                           style="height:56px;v-text-anchor:middle;width:340px;" arcsize="100%"
                           stroke="f" fillcolor="#C4582A">
                <w:anchorlock/>
                <center style="color:#FBF4DE;font-family:Georgia,serif;font-size:17px;font-weight:700;">Configurar contraseña</center>
              </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-- -->
            <a href="${linkEsc}"
               class="cta-btn"
               style="display:inline-block;
                      background:linear-gradient(180deg,#C4582A 0%,#A24818 100%);
                      color:#FBF4DE;font-size:17px;font-weight:700;
                      padding:16px 36px;border-radius:50px;
                      text-decoration:none;
                      box-shadow:0 12px 30px rgba(196,88,42,0.40),0 0 0 1px rgba(255,255,255,0.4) inset;
                      font-family:Georgia,serif;
                      letter-spacing:-0.1px;">
              Configurar contraseña e ingresar
            </a>
            <!--<![endif]-->
            <p style="margin:14px 0 0;font-size:13px;color:#9CA3AF;font-family:inherit;">
              Enlace de un solo uso · válido por 24 horas
            </p>
          </td>
        </tr>

        <!-- DIVIDER -->
        <tr>
          <td style="padding:32px 40px 12px;">
            <div style="height:1px;background:linear-gradient(90deg,transparent 0%,#E5DDC5 50%,transparent 100%);"></div>
          </td>
        </tr>

        <!-- FALLBACK CREDS -->
        <tr>
          <td class="px-40" style="padding:12px 40px 20px;text-align:left;">
            <p style="margin:0 0 12px;font-size:13px;font-weight:600;color:#6B7280;font-family:inherit;">
              ¿El enlace no funciona? Ingresa manualmente:
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                   style="background:#FBF4DE;border:1px solid #E5DDC5;border-radius:12px;">
              <tr>
                <td style="padding:16px 18px;font-size:13px;color:#4B5563;line-height:1.9;font-family:inherit;">
                  <strong style="color:#1F2937;display:inline-block;width:90px;">Sitio:</strong>
                  <a href="${loginUrl}" style="color:#C4582A;display:inline-block;">${loginUrl}</a>
                  <br>
                  <strong style="color:#1F2937;display:inline-block;width:90px;">Correo:</strong>
                  <code style="display:inline-block;background:#FFFFFF;padding:2px 8px;border-radius:5px;border:1px solid #E5DDC5;font-size:12px;font-family:Menlo,Consolas,monospace;color:#1F2937;">${emailEsc}</code>
                  <br>
                  <strong style="color:#1F2937;display:inline-block;width:90px;">Contraseña:</strong>
                  <code style="display:inline-block;background:#FFFFFF;padding:2px 8px;border-radius:5px;border:1px solid #E5DDC5;font-size:12px;font-family:Menlo,Consolas,monospace;color:#1F2937;">${tempEsc}</code>
                  <span style="font-size:11px;color:#9CA3AF;margin-left:8px;">(cámbiala al ingresar)</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- SIGN-OFF -->
        <tr>
          <td class="px-40" style="padding:24px 40px 28px;text-align:left;">
            <p style="margin:0 0 4px;font-size:15px;color:#4B5563;font-family:inherit;line-height:1.5;font-style:italic;">
              ¡Nos vemos adentro!
            </p>
            <p style="margin:0;font-size:15px;color:#1F2937;font-weight:700;font-family:Georgia,serif;">
              Romina Glatstein · ${tenant}
            </p>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="padding:24px 40px 28px;background:#FBF4DE;text-align:center;border-top:1px solid #E5DDC5;">
            <p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:#6B7280;font-family:inherit;">
              © ${opts.year} ${tenant} · Plataforma de aprendizaje
            </p>
            <p style="margin:0;font-size:11px;line-height:1.6;color:#9CA3AF;font-family:inherit;">
              ¿No esperabas esta invitación? Puedes ignorar este correo — no se realizó ningún cambio.
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

    // Two auth modes:
    //   1. User JWT: admin / super_admin / instructor calling from the
    //      dashboard (admin-user-actions invokes us this way).
    //   2. Internal service-to-service: another edge function (e.g.
    //      external-api after users.create) presents x-internal-secret
    //      matching INTERNAL_FUNCTION_SECRET. We skip the JWT + role
    //      check then, because the calling function has already
    //      authenticated its own API key holder.
    const internalSecretEnv = Deno.env.get("INTERNAL_FUNCTION_SECRET") ?? "";
    const internalSecretHeader = req.headers.get("x-internal-secret") ?? "";
    const isInternal =
      !!internalSecretEnv && internalSecretEnv === internalSecretHeader;

    const admin = createClient(supabaseUrl, serviceKey);
    let callerIdForRl = "internal";

    if (!isInternal) {
      const authHeader = req.headers.get("Authorization") ?? "";
      if (!authHeader.toLowerCase().startsWith("bearer ")) {
        return jsonResp({ error: "Unauthorized" }, 401);
      }
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authError } = await userClient.auth.getUser();
      if (authError || !user) return jsonResp({ error: "Unauthorized" }, 401);
      callerIdForRl = user.id;

      const { data: callerRoles } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .in("role", ["admin", "super_admin", "instructor"]);
      if (!callerRoles || callerRoles.length === 0) {
        return jsonResp({ error: "Forbidden" }, 403);
      }
    }

    // Per-caller rate limit (10/min) — same bucket for both auth modes
    // so an attacker who steals the internal secret can't blast either.
    const rl = await checkRateLimit(admin, `send-invite-email:${callerIdForRl}`, 10);
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: "rate_limit" }), {
        status: 429,
        headers: { ...corsHeaders, ...rl.headers, "Content-Type": "application/json" },
      });
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
