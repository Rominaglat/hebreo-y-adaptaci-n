// Email bodies for the lifecycle sequence. Copy is Romina's, verbatim from the
// source documents — do not "improve" the wording here.
//
// Voice: Rioplatense Spanish (voseo), addressed to a mostly-female audience.
// Layout mirrors send-weekly-goal-summary so all portal mail looks like one brand.

import type { LifecycleKind } from './lifecycle.ts';

// Google Docs exports some emoji as private-use codepoints that do not survive
// PDF extraction, so these two had to be recovered by hand.
// U+F03DB confirmed by Yaniv as the Israeli flag — it marks the three passages
// about belonging in Israel, one in each mail.
const EMOJI_ISRAEL = '🇮🇱'; // U+F03DB
// U+F095C confirmed by Yaniv.
const EMOJI_FAMILY = '👩‍👧‍👦'; // precedes "ayudar a tus hijos"

export function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** First name only — "Hola, María" reads better than the full legal name. */
export function firstName(fullName: string | null | undefined): string {
  return String(fullName ?? '').trim().split(/\s+/)[0] ?? '';
}

const P = 'margin:0 0 14px;font-size:16px;line-height:1.65;color:#3D2E26';
const QUOTE =
  'margin:0 0 6px;font-size:16px;line-height:1.6;color:#8A7A6D;font-style:italic;padding-left:14px;border-left:3px solid #F1E7D6';
const LEAD = 'margin:0 0 14px;font-size:17px;line-height:1.6;color:#2A2320;font-weight:700';

function shell(inner: string, ctaUrl: string, unsubscribeUrl: string): string {
  return `<!doctype html>
<html lang="es" dir="ltr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
</head>
<body style="margin:0;background:#FBF4DE;font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:linear-gradient(135deg,#C4582A,#A14823);color:#FBF4DE;padding:18px 22px;border-radius:16px 16px 0 0;font-weight:800;font-size:17px">
      🎓 Hebreo y Adaptación
    </div>
    <div style="background:#fff;padding:26px 24px;border-radius:0 0 16px 16px">
      ${inner}
      <a href="${esc(ctaUrl)}" style="display:inline-block;margin-top:8px;background:#C4582A;color:#fff;font-weight:800;font-size:16px;padding:14px 26px;border-radius:12px;text-decoration:none">
        Entrar a la Comunidad →
      </a>
    </div>
    <div style="text-align:center;font-size:11px;color:#9a8b7d;padding:14px;line-height:1.7">
      Recibís este correo porque sos parte de Hebreo y Adaptación.<br>
      <a href="${esc(unsubscribeUrl)}" style="color:#9a8b7d">Darse de baja</a>
    </div>
  </div>
</body></html>`;
}

export interface LifecycleEmailInput {
  fullName: string | null;
  ctaUrl: string;
  unsubscribeUrl: string;
  /** mailto:/wa.me target behind "escribime" in the 48h mail. */
  contactUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// ── 6h ──────────────────────────────────────────────────────────────────────
function welcome6h(i: LifecycleEmailInput): RenderedEmail {
  const inner = `
  <p style="${LEAD}">Hola 💜</p>
  <p style="${P}">Quiero hablarte de algo que probablemente te pase.</p>
  <p style="${P}">Te anotaste.<br>Estás motivada.<br>Querés aprender hebreo.</p>
  <p style="${P}">Pero pasan unas horas y pensás:</p>
  <p style="${QUOTE}">“Hoy no llego.”</p>
  <p style="${QUOTE}">“Cuando tenga más tiempo entro.”</p>
  <p style="${QUOTE}">“Mañana empiezo tranquila.”</p>
  <p style="${P}">Y así pasan los días.</p>
  <p style="${P}">Por eso quiero proponerte algo diferente.</p>
  <p style="${P}"><b>No busques tiempo para estudiar hebreo. Creá una pequeña cita contigo mismo-a.</b></p>
  <p style="${P}">No necesitás una hora.<br>Empezá con <b>10 minutos</b>.</p>
  <p style="${P}">Entrá a <a href="${esc(i.ctaUrl)}" style="color:#C4582A;font-weight:700">la Comunidad</a> y hacé solamente el primer paso.</p>
  <div style="background:#FBF7EE;border-left:3px solid #C4582A;border-radius:8px;padding:14px 16px;margin:0 0 16px">
    <p style="margin:0 0 8px;font-size:16px;font-weight:800;color:#2A2320">🎯 Tu objetivo de hoy es:</p>
    <ol style="margin:0;padding-left:20px;font-size:16px;line-height:1.7;color:#3D2E26">
      <li>Entrar a la plataforma.</li>
      <li>Abrir el primer contenido.</li>
      <li>Estudiar durante 10 minutos.</li>
      <li>Escribir una palabra o expresión que hayas aprendido.</li>
      <li>Presentarte en la comunidad.</li>
    </ol>
  </div>
  <p style="${P}">Nada más.</p>
  <p style="${P}">No estás compitiendo con nadie.</p>
  <p style="${P}">Estás construyendo una habilidad que mañana puede ayudarte a:</p>
  <p style="${P}">
    🗣 entender una conversación<br>
    🏠 desenvolverte sola<br>
    💼 acceder a mejores oportunidades<br>
    ${EMOJI_FAMILY} ayudar a tus hijos<br>
    ${EMOJI_ISRAEL} sentir que realmente pertenecés al lugar que elegiste para vivir.
  </p>
  <p style="${P}">Y recordá algo:<br>
    <b>No necesitás saber hebreo para empezar.<br>
    Necesitás empezar para aprender hebreo.</b></p>
  <p style="${P}">Nos vemos dentro de la Comunidad 💜</p>`;

  const text = `Hola 💜

Quiero hablarte de algo que probablemente te pase.

Te anotaste. Estás motivada. Querés aprender hebreo.

Pero pasan unas horas y pensás:
“Hoy no llego.”
“Cuando tenga más tiempo entro.”
“Mañana empiezo tranquila.”

Y así pasan los días.

Por eso quiero proponerte algo diferente.
No busques tiempo para estudiar hebreo. Creá una pequeña cita contigo mismo-a.

No necesitás una hora. Empezá con 10 minutos.
Entrá a la Comunidad y hacé solamente el primer paso.

🎯 Tu objetivo de hoy es:
1. Entrar a la plataforma.
2. Abrir el primer contenido.
3. Estudiar durante 10 minutos.
4. Escribir una palabra o expresión que hayas aprendido.
5. Presentarte en la comunidad.

Nada más. No estás compitiendo con nadie.

Estás construyendo una habilidad que mañana puede ayudarte a:
🗣 entender una conversación
🏠 desenvolverte sola
💼 acceder a mejores oportunidades
${EMOJI_FAMILY} ayudar a tus hijos
${EMOJI_ISRAEL} sentir que realmente pertenecés al lugar que elegiste para vivir.

Y recordá algo:
No necesitás saber hebreo para empezar.
Necesitás empezar para aprender hebreo.

Nos vemos dentro de la Comunidad 💜

${i.ctaUrl}

Darse de baja: ${i.unsubscribeUrl}`;

  return { subject: 'Tu objetivo de hoy: 10 minutos 💜', html: shell(inner, i.ctaUrl, i.unsubscribeUrl), text };
}

// ── 48h ─────────────────────────────────────────────────────────────────────
function tips48h(i: LifecycleEmailInput): RenderedEmail {
  const inner = `
  <p style="${LEAD}">Hola 💜</p>
  <p style="${P}">Hace 48 horas tomaste una decisión.<br>
    Decidiste invertir en vos y en tu capacidad para desenvolverte en Israel.</p>
  <p style="${P}">Pero hay algo que quiero que tengas muy presente:<br>
    <b>pagar una membresía no genera el cambio.</b><br>
    El cambio aparece cuando empezás a usar lo que tenés disponible.</p>
  <p style="${P}">Y quizás hoy estés pensando:</p>
  <p style="${QUOTE}">“No tuve tiempo.”</p>
  <p style="${QUOTE}">“Esta semana fue complicada.”</p>
  <p style="${QUOTE}">“Cuando me organice voy a empezar.”</p>
  <p style="${P}">Te entiendo.</p>
  <p style="${P}">Pero justamente por eso creamos una metodología que puedas incorporar a tu vida real.</p>
  <p style="${P}">No necesitás estudiar durante horas.<br>Necesitás constancia.</p>
  <p style="${P}">10 minutos hoy.<br>10 minutos mañana.<br>Una conversación.<br>Una palabra nueva.<br>Una pequeña victoria.</p>
  <p style="${P}">Y después otra.</p>
  <p style="${P}">Hasta que un día te encuentres entendiendo algo que antes necesitabas traducir.</p>
  <p style="${P}">${EMOJI_ISRAEL} Y ahí vas a darte cuenta de que algo cambió.</p>
  <p style="${P}">No solamente aprendiste hebreo.<br><b>Ganaste independencia.</b></p>
  <p style="${P}">La persona que querés ser en Israel no aparece cuando desaparecen los problemas.<br>
    Aparece cuando decidís dejar de esperar el momento perfecto y empezás a avanzar a pesar de ellos.</p>
  <p style="${P}">👉 Entrá hoy a <a href="${esc(i.ctaUrl)}" style="color:#C4582A;font-weight:700">la Comunidad</a>.<br>Hacé solamente tu primer paso.</p>
  <p style="${P}">Y si necesitás ayuda para saber exactamente por dónde comenzar, <a href="${esc(i.contactUrl)}" style="color:#C4582A;font-weight:700">escribime</a>.<br>
    Estoy acá para acompañarte.</p>
  <p style="${P}">💜 Romina</p>`;

  const text = `Hola 💜

Hace 48 horas tomaste una decisión.
Decidiste invertir en vos y en tu capacidad para desenvolverte en Israel.

Pero hay algo que quiero que tengas muy presente:
pagar una membresía no genera el cambio.
El cambio aparece cuando empezás a usar lo que tenés disponible.

Y quizás hoy estés pensando:
“No tuve tiempo.”
“Esta semana fue complicada.”
“Cuando me organice voy a empezar.”

Te entiendo.

Pero justamente por eso creamos una metodología que puedas incorporar a tu vida real.

No necesitás estudiar durante horas.
Necesitás constancia.

10 minutos hoy. 10 minutos mañana.
Una conversación. Una palabra nueva. Una pequeña victoria.
Y después otra.

Hasta que un día te encuentres entendiendo algo que antes necesitabas traducir.

${EMOJI_ISRAEL} Y ahí vas a darte cuenta de que algo cambió.

No solamente aprendiste hebreo.
Ganaste independencia.

La persona que querés ser en Israel no aparece cuando desaparecen los problemas.
Aparece cuando decidís dejar de esperar el momento perfecto y empezás a avanzar a pesar de ellos.

👉 Entrá hoy a la Comunidad: ${i.ctaUrl}
Hacé solamente tu primer paso.

Y si necesitás ayuda para saber exactamente por dónde comenzar, escribime.
Estoy acá para acompañarte.

💜 Romina

Darse de baja: ${i.unsubscribeUrl}`;

  return { subject: 'Hace 48 horas tomaste una decisión 💜', html: shell(inner, i.ctaUrl, i.unsubscribeUrl), text };
}

// ── 7d inactive ─────────────────────────────────────────────────────────────
function inactive7d(i: LifecycleEmailInput): RenderedEmail {
  // The only mail whose source copy carries a [NOMBRE] placeholder.
  const name = firstName(i.fullName);
  const greeting = name ? `Hola, ${esc(name)} 💜` : 'Hola 💜';

  const inner = `
  <p style="${LEAD}">${greeting}</p>
  <p style="${P}">Quizás ya estés pensando:</p>
  <p style="${QUOTE}">“Hace varios días que no entro... ahora voy a estar atrasada.”</p>
  <p style="${P}">Quiero detenerte ahí.</p>
  <p style="${P}"><b>No estás atrasada.</b><br>Y tampoco tenés que recuperar todo lo que no hiciste.</p>
  <p style="${P}">No necesitás mirar todas las clases.<br>No necesitás ponerte al día.<br>No necesitás estudiar durante horas.</p>
  <p style="${P}">Necesitás simplemente <b>volver a entrar.</b></p>
  <p style="${P}">Elegí una clase.<br>Escuchala.<br>Aprendé.<br>Practicá.</p>
  <p style="${P}">Y listo.</p>
  <p style="${P}">Porque uno de los errores más grandes cuando aprendemos algo nuevo es pensar:</p>
  <p style="${QUOTE}">“Si no puedo hacerlo perfecto, mejor no lo hago.”</p>
  <p style="${P}">Y eso es justamente lo que quiero que dejemos atrás.</p>
  <p style="${P}">${EMOJI_ISRAEL} Tu objetivo no es ser una estudiante perfecta de hebreo.<br>
    Tu objetivo es poder vivir tu vida en Israel con más independencia.</p>
  <p style="${P}">Así que hoy te propongo algo muy concreto:</p>
  <p style="${P}"><b>Entrá durante 10 minutos.</b><br>
    No para ponerte al día.<br>
    Para volver a conectarte con vos misma y con el motivo por el que empezaste.</p>
  <p style="${P}">💜 Te espero dentro de <a href="${esc(i.ctaUrl)}" style="color:#C4582A;font-weight:700">la Comunidad</a>.</p>
  <p style="${P}">Romina</p>`;

  const text = `${name ? `Hola, ${name} 💜` : 'Hola 💜'}

Quizás ya estés pensando:
“Hace varios días que no entro... ahora voy a estar atrasada.”

Quiero detenerte ahí.

No estás atrasada.
Y tampoco tenés que recuperar todo lo que no hiciste.

No necesitás mirar todas las clases.
No necesitás ponerte al día.
No necesitás estudiar durante horas.

Necesitás simplemente volver a entrar.

Elegí una clase. Escuchala. Aprendé. Practicá.
Y listo.

Porque uno de los errores más grandes cuando aprendemos algo nuevo es pensar:
“Si no puedo hacerlo perfecto, mejor no lo hago.”

Y eso es justamente lo que quiero que dejemos atrás.

${EMOJI_ISRAEL} Tu objetivo no es ser una estudiante perfecta de hebreo.
Tu objetivo es poder vivir tu vida en Israel con más independencia.

Así que hoy te propongo algo muy concreto:
Entrá durante 10 minutos.
No para ponerte al día.
Para volver a conectarte con vos misma y con el motivo por el que empezaste.

💜 Te espero dentro de la Comunidad: ${i.ctaUrl}

Romina

Darse de baja: ${i.unsubscribeUrl}`;

  const subject = name ? `No estás atrasada, ${name} 💜` : 'No estás atrasada 💜';
  return { subject, html: shell(inner, i.ctaUrl, i.unsubscribeUrl), text };
}

const RENDERERS: Record<LifecycleKind, (i: LifecycleEmailInput) => RenderedEmail> = {
  welcome_6h: welcome6h,
  tips_48h: tips48h,
  inactive_7d: inactive7d,
};

export function renderLifecycleEmail(kind: LifecycleKind, input: LifecycleEmailInput): RenderedEmail {
  return RENDERERS[kind](input);
}
