// goal-unsubscribe — one-click unsubscribe from weekly goal emails.
//
// Public (verify_jwt=false). The token is the capability. SECURITY: the mutation
// happens ONLY on POST — a GET merely renders a confirmation form. This prevents
// email link-prefetchers / scanners from silently unsubscribing users on GET.
// RFC 8058 one-click clients POST directly (List-Unsubscribe-Post header on the
// outgoing email), which this handler honors without a second confirmation.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

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

serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";

  if (!token) return page("Enlace inválido", `<p style="font-size:14px;color:#8A7A6D">Falta el token de baja.</p>`);

  // GET → confirmation form (no state change). POST → perform the unsubscribe.
  if (req.method !== "POST") {
    return page(
      "¿Darte de baja?",
      `<p style="font-size:14px;color:#8A7A6D;line-height:1.5;margin-bottom:16px">Dejarás de recibir los correos semanales de progreso.</p>
       <form method="POST" action="?token=${esc(token)}">
         <button type="submit" style="background:#C4582A;color:#fff;font-weight:800;font-size:15px;border:none;padding:12px 22px;border-radius:12px;cursor:pointer">Confirmar baja</button>
       </form>`,
    );
  }

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await admin
      .from("student_goals")
      .update({ emails_enabled: false })
      .eq("unsubscribe_token", token)
      .select("user_id");

    if (error) return page("Algo salió mal", `<p style="font-size:14px;color:#8A7A6D">Inténtalo de nuevo más tarde.</p>`);
    if (!data || data.length === 0) return page("Enlace inválido o vencido", `<p style="font-size:14px;color:#8A7A6D">No encontramos una suscripción para este enlace.</p>`);

    return page("Listo, te diste de baja", `<p style="font-size:14px;color:#8A7A6D;line-height:1.5">Ya no recibirás los correos semanales de progreso. Puedes volver a activarlos cuando quieras desde tu perfil.</p>`);
  } catch (_) {
    return page("Algo salió mal", `<p style="font-size:14px;color:#8A7A6D">Inténtalo de nuevo más tarde.</p>`);
  }
});
