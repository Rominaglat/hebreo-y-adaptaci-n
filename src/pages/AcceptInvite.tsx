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
  const { language } = useLanguage();
  const isHe = language === 'he';

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
        setError(
          isHe
            ? 'הקישור פג תוקף או שכבר נעשה בו שימוש. ניתן להיכנס באמצעות הסיסמה הזמנית שנשלחה במייל.'
            : 'The invite link has expired or was already used. Please use the temporary password from your email.',
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isHe]);

  const schema = z
    .object({
      password: z.string().min(12, isHe ? 'הסיסמה חייבת להכיל לפחות 12 תווים' : 'Min 12 chars'),
      confirm: z.string(),
    })
    .refine((d) => d.password === d.confirm, {
      message: isHe ? 'הסיסמאות אינן תואמות' : 'Passwords do not match',
      path: ['confirm'],
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = schema.safeParse({ password, confirm });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? 'שגיאה');
      return;
    }
    // Policy + breach check (matches Profile / ManageUsers flows).
    const { validatePassword } = await import('@/lib/passwordPolicy');
    const check = await validatePassword(password);
    if (!check.ok) {
      setError(check.error ?? (isHe ? 'הסיסמה לא תקפה' : 'Invalid password'));
      return;
    }

    setSubmitting(true);
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) throw updErr;
      toast({
        title: isHe ? 'הסיסמה הוגדרה' : 'Password set',
        description: isHe ? 'נכנסים לפורטל…' : 'Signing you in…',
      });
      navigate('/dashboard', { replace: true });
    } catch (e: any) {
      setError(e?.message ?? (isHe ? 'שגיאה' : 'Error'));
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
            {isHe ? 'ברוכים הבאים' : 'Welcome'}
          </CardTitle>
          <CardDescription>
            {sessionReady
              ? isHe
                ? `נא להגדיר סיסמה אישית עבור ${email ?? ''}`
                : `Set a personal password for ${email ?? ''}`
              : isHe
              ? 'הקישור פג תוקף'
              : 'Link expired'}
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
                <Label htmlFor="pw">{isHe ? 'סיסמה חדשה' : 'New password'}</Label>
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
                  {isHe
                    ? 'לפחות 12 תווים: אות, ספרה וסימן.'
                    : 'At least 12 chars: letter, digit, symbol.'}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">{isHe ? 'אישור סיסמה' : 'Confirm password'}</Label>
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
                {isHe ? 'הגדרת סיסמה והכניסה' : 'Set password & sign in'}
              </Button>
            </form>
          ) : (
            <Button onClick={() => navigate('/login')} className="w-full">
              {isHe ? 'מעבר למסך הכניסה' : 'Go to sign-in'}
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
