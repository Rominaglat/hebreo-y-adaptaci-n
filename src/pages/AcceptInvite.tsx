// Landing page for the recovery magic-link in the invite email.
//
// Flow:
//   1. User clicks the link in their email.
//   2. Supabase Auth processes the URL fragment (#access_token=...) and
//      stores a session via the SDK on page load.
//   3. We confirm the session is live, then prompt them to choose a fresh
//      password (the temp password sent as fallback is technically still
//      valid, so we force a change here).
//   4. On success, redirect to /dashboard.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Loader2, Lock, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

export default function AcceptInvite() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useLanguage();

  const [sessionReady, setSessionReady] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wait for Supabase to process the recovery hash. The SDK fires SIGNED_IN
  // automatically when the URL contains a recovery token; we just confirm.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Small grace period so the SDK has time to consume the hash.
      await new Promise((r) => setTimeout(r, 200));
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session?.user) {
        setSessionReady(true);
        setEmail(data.session.user.email ?? null);
      } else {
        setSessionReady(false);
        setError(t('acceptInvite.linkExpiredDetail'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const schema = z
    .object({
      password: z.string().min(12, t('acceptInvite.passwordMinChars')),
      confirm: z.string(),
    })
    .refine((d) => d.password === d.confirm, {
      message: t('auth.passwordsDontMatch'),
      path: ['confirm'],
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = schema.safeParse({ password, confirm });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? t('common.error'));
      return;
    }
    // Policy + breach check (matches Profile / ManageUsers flows).
    const { validatePassword } = await import('@/lib/passwordPolicy');
    const check = await validatePassword(password);
    if (!check.ok) {
      setError(check.error ?? t('acceptInvite.invalidPassword'));
      return;
    }

    setSubmitting(true);
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) throw updErr;
      toast({
        title: t('acceptInvite.passwordSet'),
        description: t('acceptInvite.signingYouIn'),
      });
      navigate('/dashboard', { replace: true });
    } catch (e: any) {
      setError(e?.message ?? t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  if (sessionReady === null) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-xl">
            {t('acceptInvite.welcome')}
          </CardTitle>
          <CardDescription>
            {sessionReady
              ? `${t('acceptInvite.setPasswordFor')} ${email ?? ''}`
              : t('acceptInvite.linkExpiredShort')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {sessionReady ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pw">{t('profile.newPassword')}</Label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="pw"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="pr-10"
                    autoComplete="new-password"
                    disabled={submitting}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('acceptInvite.passwordRequirements')}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">{t('auth.confirmPassword')}</Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  disabled={submitting}
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="w-4 h-4 mx-2 animate-spin" /> : null}
                {t('acceptInvite.setPasswordSignIn')}
              </Button>
            </form>
          ) : (
            <Button onClick={() => navigate('/login')} className="w-full">
              {t('acceptInvite.goToSignIn')}
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
