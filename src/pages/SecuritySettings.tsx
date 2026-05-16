// SEC-013 — MFA (TOTP) enrollment + management UI.
//
// Flow:
//   1. Read the current MFA factors via supabase.auth.mfa.listFactors().
//   2. If no verified factor exists, offer to enroll: show QR + ask for the
//      first 6-digit TOTP code, then call verify().
//   3. If a verified factor exists, offer to unenroll (with a confirm dialog).
//   4. Admins / super_admins should enroll within the soft-enrollment window;
//      a banner in DashboardLayout reminds them.
//
// Note: Enabling the TOTP factor type requires a one-time toggle in the
// Supabase Dashboard → Authentication → Multi-Factor Authentication. The
// frontend assumes the factor type is enabled; if it's not, the listFactors /
// enroll calls will fail with a clear error.

import { useEffect, useState } from 'react';
import { Shield, Loader2, ShieldCheck, ShieldAlert, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';

type Factor = {
  id: string;
  factor_type: string;
  status: string;
  friendly_name?: string | null;
};

export default function SecuritySettings() {
  const { language } = useLanguage();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollData, setEnrollData] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  const isHe = language === 'he';

  const refresh = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      const all: Factor[] = [
        ...(data?.totp ?? []).map((f) => ({ ...f, factor_type: 'totp' })),
        ...(data?.phone ?? []).map((f) => ({ ...f, factor_type: 'phone' })),
      ];
      setFactors(all);
    } catch (e: any) {
      toast({
        title: isHe ? 'שגיאה' : 'Error',
        description: e?.message ?? (isHe ? 'טעינת המידע נכשלה' : 'Failed to load MFA factors'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const verifiedTotp = factors.find((f) => f.factor_type === 'totp' && f.status === 'verified');
  const unverifiedTotp = factors.find((f) => f.factor_type === 'totp' && f.status === 'unverified');

  const handleStartEnroll = async () => {
    setEnrolling(true);
    try {
      // If there's a leftover unverified factor, remove it first so enroll can succeed.
      if (unverifiedTotp) {
        await supabase.auth.mfa.unenroll({ factorId: unverifiedTotp.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
      if (error) throw error;
      if (!data) throw new Error('No enrollment data');
      setEnrollData({
        factorId: data.id,
        qrCode: data.totp?.qr_code ?? '',
        secret: data.totp?.secret ?? '',
      });
    } catch (e: any) {
      toast({
        title: isHe ? 'שגיאה' : 'Error',
        description: e?.message ?? (isHe ? 'ההרשמה נכשלה' : 'Enrollment failed'),
        variant: 'destructive',
      });
    } finally {
      setEnrolling(false);
    }
  };

  const handleVerify = async () => {
    if (!enrollData) return;
    if (!/^\d{6}$/.test(code)) {
      toast({
        title: isHe ? 'קוד לא תקין' : 'Invalid code',
        description: isHe ? 'יש להזין קוד בן 6 ספרות' : 'Enter a 6-digit code',
        variant: 'destructive',
      });
      return;
    }
    setVerifying(true);
    try {
      const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({
        factorId: enrollData.factorId,
      });
      if (cErr) throw cErr;
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: enrollData.factorId,
        challengeId: challenge!.id,
        code,
      });
      if (vErr) throw vErr;
      toast({
        title: isHe ? 'אימות דו־שלבי הופעל' : 'Two-factor enabled',
        description: isHe ? 'הקוד אומת בהצלחה.' : 'Verified successfully.',
      });
      setEnrollData(null);
      setCode('');
      await refresh();
    } catch (e: any) {
      toast({
        title: isHe ? 'אימות נכשל' : 'Verification failed',
        description: e?.message ?? '',
        variant: 'destructive',
      });
    } finally {
      setVerifying(false);
    }
  };

  const handleUnenroll = async () => {
    if (!verifiedTotp) return;
    if (
      !confirm(
        isHe
          ? 'להסיר את האימות הדו־שלבי? פעולה זו פותחת חזרה לסיכון השתלטות חשבון.'
          : 'Disable two-factor authentication? This re-opens you to account takeover risk.',
      )
    ) {
      return;
    }
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: verifiedTotp.id });
      if (error) throw error;
      toast({
        title: isHe ? 'הוסר' : 'Removed',
        description: isHe ? 'האימות הדו־שלבי הוסר.' : 'Two-factor disabled.',
      });
      await refresh();
    } catch (e: any) {
      toast({
        title: isHe ? 'שגיאה' : 'Error',
        description: e?.message ?? '',
        variant: 'destructive',
      });
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-16 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-6 px-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Shield className="w-6 h-6" />
          {isHe ? 'אבטחת חשבון' : 'Account security'}
        </h1>
        <p className="text-muted-foreground mt-1">
          {isHe
            ? 'הגדרת אימות דו־שלבי (TOTP) לחיזוק האבטחה של החשבון.'
            : 'Configure two-factor authentication (TOTP) to harden your account.'}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {verifiedTotp ? (
              <>
                <ShieldCheck className="w-5 h-5 text-green-500" />
                {isHe ? 'אימות דו־שלבי פעיל' : 'Two-factor active'}
              </>
            ) : (
              <>
                <ShieldAlert className="w-5 h-5 text-yellow-500" />
                {isHe ? 'אימות דו־שלבי כבוי' : 'Two-factor disabled'}
              </>
            )}
          </CardTitle>
          <CardDescription>
            {isHe
              ? 'אפליקציית TOTP כמו Authy, 1Password או Google Authenticator תייצר קוד בן 6 ספרות שמתחדש כל 30 שניות.'
              : 'A TOTP app such as Authy, 1Password, or Google Authenticator will generate a 6-digit code every 30 seconds.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {verifiedTotp ? (
            <Button variant="destructive" onClick={handleUnenroll}>
              <Trash2 className="w-4 h-4 mx-2" />
              {isHe ? 'הסר אימות דו־שלבי' : 'Disable two-factor'}
            </Button>
          ) : enrollData ? (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  {isHe
                    ? 'יש לסרוק את ה־QR באפליקציית האימות, ואז להזין את הקוד בן 6 הספרות שמופיע.'
                    : 'Scan the QR with your authenticator app, then enter the 6-digit code it displays.'}
                </AlertDescription>
              </Alert>
              {enrollData.qrCode && (
                <div className="flex justify-center">
                  <img
                    src={enrollData.qrCode}
                    alt="TOTP QR code"
                    className="w-48 h-48 bg-white rounded-md p-2"
                  />
                </div>
              )}
              {enrollData.secret && (
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">
                    {isHe ? 'או הזנה ידנית של הסוד:' : 'Or enter manually:'}
                  </p>
                  <code className="text-sm bg-muted px-2 py-1 rounded">
                    {enrollData.secret}
                  </code>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="totp-code">
                  {isHe ? 'קוד מהאפליקציה' : 'Code from your app'}
                </Label>
                <Input
                  id="totp-code"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleVerify} disabled={verifying || code.length !== 6}>
                  {verifying ? (
                    <Loader2 className="w-4 h-4 mx-2 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-4 h-4 mx-2" />
                  )}
                  {isHe ? 'אימות והפעלה' : 'Verify & enable'}
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    if (enrollData) {
                      await supabase.auth.mfa.unenroll({ factorId: enrollData.factorId });
                    }
                    setEnrollData(null);
                    setCode('');
                    await refresh();
                  }}
                >
                  {isHe ? 'ביטול' : 'Cancel'}
                </Button>
              </div>
            </div>
          ) : (
            <Button onClick={handleStartEnroll} disabled={enrolling}>
              {enrolling ? (
                <Loader2 className="w-4 h-4 mx-2 animate-spin" />
              ) : (
                <Shield className="w-4 h-4 mx-2" />
              )}
              {isHe ? 'הפעלת אימות דו־שלבי' : 'Enable two-factor'}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
