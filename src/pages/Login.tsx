import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Lock, Loader2, Mail } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { markFullAuth } from '@/lib/sessionGuard';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { LanguageSelector } from '@/components/LanguageSelector';
import AuroraFlow from '@/components/ui/aurora-flow';
import logo from '@/assets/logo.png';

type FieldErrors = {
  email?: string;
  password?: string;
};

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const navigate = useNavigate();
  const { toast } = useToast();
  const { signIn, user } = useAuth();
  const { t } = useLanguage();

  useEffect(() => {
    document.title = 'התחברות | Learning Portal';
  }, []);

  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true });
  }, [user, navigate]);

  const loginSchema = useMemo(
    () =>
      z.object({
        email: z.string().trim().email(t('auth.invalidEmail')),
        password: z.string().min(6, t('auth.passwordMinLength')),
      }),
    [t]
  );

  const extractZodErrors = (errors: z.ZodError<any>): FieldErrors => {
    const fieldErrors: FieldErrors = {};
    errors.errors.forEach((err) => {
      const key = err.path[0] as keyof FieldErrors | undefined;
      if (!key) return;
      fieldErrors[key] = err.message;
    });
    return fieldErrors;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const result = loginSchema.safeParse({ email, password });
    if (!result.success) {
      setErrors(extractZodErrors(result.error));
      return;
    }

    setIsLoading(true);
    try {
      // SEC-025 — soft lockout: refuse to even try the auth endpoint after
      // 5 failed attempts from this email in the last 15 minutes. The
      // auth-guard edge function is rate-limited per IP so it can't be used
      // to enumerate emails. Best-effort; a determined attacker hits the
      // /auth/v1/token endpoint directly. CAPTCHA + WAF (operational steps)
      // are the real fix.
      try {
        const guard = await supabase.functions.invoke('auth-guard', {
          body: { action: 'check', email: email.trim() },
        });
        if ((guard.data as { locked?: boolean } | null)?.locked) {
          toast({
            title: t('auth.loginFailed'),
            description: 'יותר מדי ניסיונות. נסו שוב בעוד 15 דקות.',
            variant: 'destructive',
          });
          return;
        }
      } catch {
        // Guard endpoint is best-effort; never block legitimate users if it
        // is unavailable.
      }

      const { error } = await signIn(email.trim(), password);

      if (error) {
        // Record the failed attempt (fire-and-forget).
        try {
          await supabase.functions.invoke('auth-guard', {
            body: { action: 'record-failure', email: email.trim() },
          });
        } catch {
          /* ignore */
        }
        toast({
          title: t('auth.loginFailed'),
          description: error.message.includes('Invalid login credentials')
            ? t('auth.wrongCredentials')
            : error.message,
          variant: 'destructive',
        });
        return;
      }

      // Stamp the last full-auth time so sensitive ops can require fresh auth.
      markFullAuth();

      toast({
        title: t('auth.welcomeMessage'),
        description: t('auth.loginSuccess'),
      });

      navigate('/dashboard');
    } catch {
      toast({
        title: t('common.error'),
        description: t('auth.unexpectedError'),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Aurora background */}
      <div className="absolute inset-0 z-0">
        <AuroraFlow resolutionScale={1} />
      </div>

      <div className="absolute top-4 left-4 z-10">
        <LanguageSelector />
      </div>

      <motion.section
        className="w-full max-w-md relative z-[2]"
        aria-label="Authentication"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <header className="text-center mb-8">
          <div className="inline-flex items-center justify-center bg-white/10 backdrop-blur-md p-4 rounded-2xl shadow-lg shadow-black/20 mb-5 border border-white/10">
            <img
              src={logo}
              alt="Learning Portal logo"
              className="w-16 h-16 rounded-xl"
              loading="eager"
            />
          </div>
          <h1 className="text-2xl font-bold text-white">Learning Portal</h1>
          <p className="text-white/60 mt-1">{t('auth.portalSubtitle')}</p>
        </header>

        <Card className="border-white/10 shadow-2xl shadow-black/30 backdrop-blur-xl bg-black/40">
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl text-white">{t('auth.loginTitle')}</CardTitle>
            <CardDescription className="text-white/50">{t('auth.loginDesc')}</CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-white/80">{t('auth.email')}</Label>
                <div className="relative">
                  <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={`pr-10 bg-white/5 border-purple-500/30 text-white placeholder:text-white/25 focus-visible:ring-purple-500/50 focus-visible:border-purple-400/60 ${errors.email ? 'border-destructive ring-2 ring-destructive/20' : ''}`}
                    style={{ textAlign: 'right', direction: 'rtl' }}
                    disabled={isLoading}
                    autoComplete="username"
                  />
                </div>
                {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-white/80">{t('auth.password')}</Label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`pr-10 bg-white/5 border-purple-500/30 text-white placeholder:text-white/25 focus-visible:ring-purple-500/50 focus-visible:border-purple-400/60 ${errors.password ? 'border-destructive ring-2 ring-destructive/20' : ''}`}
                    disabled={isLoading}
                    autoComplete="current-password"
                  />
                </div>
                {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
              </div>

              <Button type="submit" className="w-full h-11 font-medium bg-purple-600 hover:bg-purple-500 shadow-lg shadow-purple-900/40" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                    {t('auth.loggingIn')}
                  </>
                ) : (
                  t('auth.loginButton')
                )}
              </Button>
            </form>

            <div className="mt-6 pt-6 border-t border-white/10">
              <p className="text-sm text-white/40 text-center">{t('auth.inviteOnly')}</p>
            </div>
          </CardContent>
        </Card>
      </motion.section>
    </main>
  );
}
