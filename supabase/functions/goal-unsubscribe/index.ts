// goal-unsubscribe — one-click unsubscribe from weekly goal emails.
//
// Public (verify_jwt=false). GET ?token=<unsubscribe_token> flips the student's
// student_goals.emails_enabled to false and returns a small Spanish confirmation
// page. No login required (the token is the capability).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

function page(title: string, body: string): Response {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title></head>
  <body style="margin:0;background:#FBF4DE;font-family:system-ui,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center">
    <div style="max-width:420px;background:#fff;border-radius:16px;padding:32px;text-align:center;box-shadow:0 10px 30px rgba(42,35,32,.15)">
      <div style="font-size:32px">📭</div>
      <h1 style="font-size:20px;color:#2A2320;margin:12px 0 6px">${title}</h1>
      <p style="font-size:14px;color:#8A7A6D;line-height:1.5">${body}</p>
    </div>
  </body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") ?? "";
    if (!token) return page("Enlace inválido", "Falta el token de baja.");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await admin
      .from("student_goals")
      .update({ emails_enabled: false })
      .eq("unsubscribe_token", token)
      .select("user_id");

    if (error) return page("Algo salió mal", "Inténtalo de nuevo más tarde.");
    if (!data || data.length === 0) return page("Enlace inválido o vencido", "No encontramos una suscripción para este enlace.");

    return page("Listo, te diste de baja", "Ya no recibirás los correos semanales de progreso. Puedes volver a activarlos cuando quieras desde tu perfil.");
  } catch (_) {
    return page("Algo salió mal", "Inténtalo de nuevo más tarde.");
  }
});
