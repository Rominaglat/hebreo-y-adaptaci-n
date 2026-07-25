import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import logo from '@/assets/logo.svg';

// Public, unauthenticated page. Genuine terms notice for students and a trust
// signal for reputation/anti-phishing scanners.
export default function Terms() {
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

        <h1 className="text-2xl font-bold mb-1">Términos de Uso</h1>
        <p className="text-sm text-muted-foreground mb-8">Última actualización: 25 de julio de 2026</p>

        <div className="space-y-6 text-sm leading-relaxed">
          <section>
            <p>
              Al acceder a «Hebreo y Adaptación» (operada por Romina Glatstein) aceptas estos términos.
              Si no estás de acuerdo, no utilices la plataforma.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-primary mb-2">Acceso</h2>
            <p>
              El acceso es personal y por invitación. Eres responsable de mantener la confidencialidad
              de tus credenciales y de toda la actividad realizada desde tu cuenta. No compartas tu
              acceso con terceros.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-primary mb-2">Contenido</h2>
            <p>
              Todos los materiales del curso (vídeos, textos, recursos y ejercicios) son propiedad de
              Romina Glatstein — Hebreo y Adaptación y se ofrecen para tu uso educativo personal. No
              está permitido copiarlos, redistribuirlos ni publicarlos sin autorización.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-primary mb-2">Uso aceptable</h2>
            <p>
              Te comprometes a usar la plataforma de forma lícita y respetuosa, sin intentar acceder a
              cuentas ajenas, interferir con el servicio ni cargar contenido ofensivo o ilegal.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-primary mb-2">Disponibilidad</h2>
            <p>
              Procuramos que el servicio esté disponible de forma continua, pero puede haber
              interrupciones por mantenimiento o causas ajenas. El servicio se ofrece «tal cual», sin
              garantías de disponibilidad ininterrumpida.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-primary mb-2">Cambios</h2>
            <p>
              Podemos actualizar estos términos cuando sea necesario. Publicaremos la versión vigente en
              esta página con su fecha de actualización.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-primary mb-2">Contacto</h2>
            <p>
              Para cualquier duda escríbenos a{' '}
              <a href="mailto:soporte@rominahebreo.com" className="text-primary underline underline-offset-4">
                soporte@rominahebreo.com
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
