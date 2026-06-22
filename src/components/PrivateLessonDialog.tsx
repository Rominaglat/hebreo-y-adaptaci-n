import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { GraduationCap, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import {
  validateLeadForm,
  submitPrivateLessonRequest,
  type LeadForm,
} from '@/lib/privateLesson';

/**
 * Top-bar call-to-action + popup for requesting a paid 1:1 private lesson.
 * Self-contained: drop `<PrivateLessonDialog />` into the header next to search.
 * Pre-fills the lead form from the signed-in profile and POSTs to a Make webhook.
 *
 * The trigger uses `DialogTrigger` (rather than a bare button + manual open)
 * so Radix excludes it from outside-click dismissal — without it, the click
 * that opens the dialog can be read as an outside interaction and close it.
 */
export function PrivateLessonDialog() {
  const { profile } = useAuth();
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const location = useLocation();

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<'name' | 'email' | 'contact' | null>(null);
  const [form, setForm] = useState<LeadForm>({ name: '', email: '', phone: '' });

  // Re-sync from the profile every time the popup opens: the freshest details
  // are pre-filled, and any edits from a previous (cancelled) open are dropped.
  useEffect(() => {
    if (!open) return;
    setForm({
      name: profile?.full_name ?? '',
      email: profile?.email ?? '',
      phone: profile?.phone ?? '',
    });
    setError(null);
  }, [open, profile?.full_name, profile?.email, profile?.phone]);

  const update =
    (field: keyof LeadForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
      setError(null);
    };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateLeadForm(form);
    if (!validation.ok) {
      setError(validation.field ?? null);
      return;
    }

    setSubmitting(true);
    try {
      await submitPrivateLessonRequest(form, {
        userId: profile?.id ?? null,
        locale: language,
        page: location.pathname,
        submittedAt: new Date().toISOString(),
      });
      toast({
        title: t('privateLesson.toast.success.title'),
        description: t('privateLesson.toast.success.desc'),
      });
      setOpen(false);
    } catch (err) {
      console.error('Private lesson request failed:', err);
      toast({
        title: t('privateLesson.toast.error.title'),
        description: t('privateLesson.toast.error.desc'),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="default"
          size="sm"
          className="gap-1.5 shadow-sm"
          aria-label={t('privateLesson.button')}
        >
          <GraduationCap className="w-4 h-4" />
          <span className="hidden md:inline">{t('privateLesson.button')}</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-primary" />
            {t('privateLesson.title')}
          </DialogTitle>
          <DialogDescription>{t('privateLesson.description')}</DialogDescription>
        </DialogHeader>

        {/* Emphasized "additional charge" note — visually distinct from the
            description so the extra-cost point cannot be missed. */}
        <p className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-foreground/90">
          {t('privateLesson.paidNote')}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pl-name">{t('privateLesson.field.name')}</Label>
            <Input id="pl-name" value={form.name} onChange={update('name')} autoFocus />
            {error === 'name' && (
              <p className="text-sm text-destructive">{t('privateLesson.validation.name')}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pl-email">{t('privateLesson.field.email')}</Label>
            <Input
              id="pl-email"
              type="email"
              dir="ltr"
              value={form.email}
              onChange={update('email')}
            />
            {error === 'email' && (
              <p className="text-sm text-destructive">{t('privateLesson.validation.email')}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pl-phone">{t('privateLesson.field.phone')}</Label>
            <Input
              id="pl-phone"
              type="tel"
              dir="ltr"
              value={form.phone}
              onChange={update('phone')}
            />
          </div>

          {error === 'contact' && (
            <p className="text-sm text-destructive">{t('privateLesson.validation.contact')}</p>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={submitting}>
                {t('common.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={submitting} className="gap-2">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('privateLesson.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
