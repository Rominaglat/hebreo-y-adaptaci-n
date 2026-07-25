import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import logo from '@/assets/logo.svg';

// Public, unauthenticated page. Exists both as a genuine privacy notice for
// students and as a trust signal so app.rominahebreo.com reads as a real
// product to reputation/anti-phishing scanners.
export default function Privacy() {
  return (
    <main dir="ltr" lang="es" className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-5 py-10">
        <header className="flex items-center gap-3 mb-8">
          <img src={logo} alt="Hebreo y Adaptación" className="w-11 h-11 rounded-xl" />
          <div>
            <p className="font-bold leading-tight">Hebreo y Adaptación</p>
            <p className="text-xs text-muted-foreground">Romina Glatstein</p>
          </div>
        </header>

        <h1 className="text-2xl font-bold mb-1">Política de Privacidad</h1>
        <p className="text-sm text-muted-foreground mb-8">Última actualización: 25 de julio de 2026</p>

        <div className="space-y-6 text-sm leading-relaxed">
          <section>
            <p>
              Esta plataforma («Hebreo y Adaptación», operada por Romina Glatstein) es un portal
              educativo de acceso por invitación. Esta política explica qué datos tratamos, con qué
              finalidad y cuáles son tus derechos.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-primary mb-2">Datos que tratamos</h2>
            <ul className="list-disc ps-5 space-y-1">
              <li>Datos de cuenta: nombre y correo electrónico.</li>
              <li>Actividad de aprendizaje: progreso, lecciones completadas y objetivos.</li>
              <li>Entregas de tareas: texto y, opcionalmente, grabaciones de voz que envías.</li>
              <li>Mensajes que escribes al asistente de inteligencia artificial de la plataforma.</li>
              <li>En las salas de estudio en directo: el audio y el vídeo de tu micrófono y cámara mientras participas.</li>
              <li>Datos técnicos mínimos necesarios para la seguridad de la sesión.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-primary mb-2">Finalidad</h2>
            <p>
              Usamos estos datos únicamente para prestar el servicio educativo: autenticar tu acceso,
              mostrar tu progreso, permitir la entrega y revisión de tareas y comunicarnos contigo
              sobre el curso. No vendemos tus datos ni los usamos con fines publicitarios.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-primary mb-2">Proveedores</h2>
            <p>Nos apoyamos en proveedores que tratan datos por cuenta nuestra, cada uno limitado a su función:</p>
            <ul className="list-disc ps-5 space-y-1 mt-2">
              <li>Supabase — base de datos, autenticación y almacenamiento de archivos.</li>
              <li>Resend — envío de correos electrónicos.</li>
              <li>Vercel y Cloudflare — alojamiento y red.</li>
              <li>
                Google (Gemini) — cuando usas el asistente de inteligencia artificial o funciones
                inteligentes, tu mensaje y el contenido de la lección se envían a Google para generar
                la respuesta, la transcripción o las recomendaciones.
              </li>
              <li>Un servicio de grafo de conocimiento que procesa contenido de los cursos para generar recomendaciones de aprendizaje.</li>
              <li>Sentry — registro de errores técnicos para mantener el servicio (cuando está activado).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-primary mb-2">Salas de estudio en directo</h2>
            <p>
              Las salas de estudio funcionan mediante conexión directa entre participantes (WebRTC).
              Durante una sesión, tu audio, tu vídeo y tu dirección IP se comparten directamente con las
              demás personas presentes en la sala para hacer posible la videollamada.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-primary mb-2">Conservación y seguridad</h2>
            <p>
              Conservamos tus datos mientras tu cuenta esté activa. Aplicamos control de acceso a nivel
              de fila, cifrado en tránsito (HTTPS) y buenas prácticas de seguridad para proteger tu
              información.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-primary mb-2">Tus derechos</h2>
            <p>
              Puedes solicitar acceso, rectificación o eliminación de tus datos escribiéndonos a{' '}
              <a href="mailto:almaanabella83@gmail.com" className="text-primary underline underline-offset-4">
                almaanabella83@gmail.com
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-primary mb-2">Contacto</h2>
            <p>
              Responsable: Romina Glatstein — Hebreo y Adaptación. Correo:{' '}
              <a href="mailto:almaanabella83@gmail.com" className="text-primary underline underline-offset-4">
                almaanabella83@gmail.com
              </a>
              .
            </p>
          </section>
        </div>

        <div className="mt-10 pt-6 border-t border-border">
          <Link to="/login" className="inline-flex items-center gap-2 text-sm text-primary hover:underline underline-offset-4">
            <ArrowLeft className="w-4 h-4 rtl:rotate-180" /> Volver al inicio de sesión
          </Link>
        </div>
      </div>
    </main>
  );
}
