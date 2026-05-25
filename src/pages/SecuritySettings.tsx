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
  const { t } = useLanguage();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollData, setEnrollData] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);

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
        title: t('common.error'),
        description: e?.message ?? t('securitySettings.loadFailed'),
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
        title: t('common.error'),
        description: e?.message ?? t('securitySettings.enrollFailed'),
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
        title: t('securitySettings.invalidCode'),
        description: t('securitySettings.enter6DigitCode'),
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
        title: t('securitySettings.twoFactorEnabled'),
        description: t('securitySettings.verifiedSuccessfully'),
      });
      setEnrollData(null);
      setCode('');
      await refresh();
    } catch (e: any) {
      toast({
        title: t('securitySettings.verificationFailed'),
        description: e?.message ?? '',
        variant: 'destructive',
      });
    } finally {
      setVerifying(false);
    }
  };

  const handleUnenroll = async () => {
    if (!verifiedTotp) return;
    if (!confirm(t('securitySettings.disableConfirm'))) {
      return;
    }
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: verifiedTotp.id });
      if (error) throw error;
      toast({
        title: t('securitySettings.removed'),
        description: t('securitySettings.twoFactorDisabled'),
      });
      await refresh();
    } catch (e: any) {
      toast({
        title: t('common.error'),
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
          {t('securitySettings.title')}
        </h1>
        <p className="text-muted-foreground mt-1">
          {t('securitySettings.subtitle')}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {verifiedTotp ? (
              <>
                <ShieldCheck className="w-5 h-5 text-green-500" />
                {t('securitySettings.twoFactorActive')}
              </>
            ) : (
              <>
                <ShieldAlert className="w-5 h-5 text-yellow-500" />
                {t('securitySettings.twoFactorOff')}
              </>
            )}
          </CardTitle>
          <CardDescription>
            {t('securitySettings.totpAppDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {verifiedTotp ? (
            <Button variant="destructive" onClick={handleUnenroll}>
              <Trash2 className="w-4 h-4 mx-2" />
              {t('securitySettings.disableTwoFactor')}
            </Button>
          ) : enrollData ? (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  {t('securitySettings.scanQrInstruction')}
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
                    {t('securitySettings.orEnterManually')}
                  </p>
                  <code className="text-sm bg-muted px-2 py-1 rounded">
                    {enrollData.secret}
                  </code>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="totp-code">
                  {t('securitySettings.codeFromApp')}
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
                  {t('securitySettings.verifyAndEnable')}
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
                  {t('common.cancel')}
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
              {t('securitySettings.enableTwoFactor')}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
