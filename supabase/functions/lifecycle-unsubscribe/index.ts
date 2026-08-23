// lifecycle-unsubscribe — one-click opt-out of the onboarding / win-back mails.
//
// Public (verify_jwt=false). The token IS the capability, which is why
// lifecycle_email_prefs is service-role-only: the browser must never be able to
// read someone's token.
//
// SECURITY: the mutation happens ONLY on POST. A GET renders a confirmation
// form, so inbox link-prefetchers and security scanners cannot silently
// unsubscribe people by following the link. RFC 8058 one-click clients POST
// directly (we set List-Unsubscribe-Post on the outgoing mail) and are honoured
// without a second confirmation.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// A token that is not a uuid can never match a row — reject it before it ever
// reaches the query, so the endpoint cannot be used to probe with junk.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(title: string, bodyHtml: string): Response {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title></head>
  <body style="margin:0;background:#FBF4DE;font-family:system-ui,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center">
    <div style="max-width:420px;background:#fff;border-radius:16px;padding:32px;text-align:center;box-shadow:0 10px 30px rgba(42,35,32,.15)">
      <div style="font-size:32px">📭</div>
      <h1 style="font-size:20px;color:#2A2320;margin:12px 0 6px">${esc(title)}</h1>
      ${bodyHtml}
    </div>
  </body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const MUTED = 'style="font-size:14px;color:#8A7A6D;line-height:1.5"';

serve(async (req) => {
  const token = new URL(req.url).searchParams.get("token") ?? "";

  if (!token || !UUID_RE.test(token)) {
    return page("Enlace inválido", `<p ${MUTED}>Falta el token de baja o no es válido.</p>`);
  }

  if (req.method !== "POST") {
    return page(
      "¿Darte de baja?",
      `<p ${MUTED} style="margin-bottom:16px">Dejarás de recibir los correos de acompañamiento de Hebreo y Adaptación.</p>
       <form method="POST" action="?token=${esc(token)}">
         <button type="submit" style="background:#C4582A;color:#fff;font-weight:800;font-size:15px;border:none;padding:12px 22px;border-radius:12px;cursor:pointer">Confirmar baja</button>
       </form>`,
    );
  }

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await admin
      .from("lifecycle_email_prefs")
      .update({ emails_enabled: false, unsubscribed_at: new Date().toISOString() })
      .eq("unsubscribe_token", token)
      .select("user_id");

    if (error) return page("Algo salió mal", `<p ${MUTED}>Inténtalo de nuevo más tarde.</p>`);
    if (!data || data.length === 0) {
      return page("Enlace inválido o vencido", `<p ${MUTED}>No encontramos una suscripción para este enlace.</p>`);
    }

    return page(
      "Listo, te diste de baja",
      `<p ${MUTED}>Ya no vas a recibir estos correos. Tu acceso a la Comunidad sigue igual — podés entrar cuando quieras.</p>`,
    );
  } catch (_) {
    return page("Algo salió mal", `<p ${MUTED}>Inténtalo de nuevo más tarde.</p>`);
  }
});
