import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOwnContactOptOut } from '@/hooks/useContactSuppression';

/**
 * Footer line on the survey page: lets a student stop — and restart — every
 * message the portal sends them (WhatsApp, emails, push). The survey link is
 * the one place every student reaches from a WhatsApp message, and the
 * WhatsApp template can't carry a per-student unsubscribe link without Meta
 * re-approving it.
 */
export function ContactOptOut() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { toast } = useToast();
  const { optedOut, loading, saving, update } = useOwnContactOptOut(user?.id);

  if (!user || loading) return null;

  const toggle = async () => {
    const next = !optedOut;
    const ok = await update(next);
    toast(ok
      ? { title: t(next ? 'contacts.optOut.savedOff' : 'contacts.optOut.savedOn') }
      : { title: t('contacts.optOut.error'), variant: 'destructive' });
  };

  return (
    <p className="text-xs text-muted-foreground text-center leading-relaxed">
      {t(optedOut ? 'contacts.optOut.isOff' : 'contacts.optOut.question')}{' '}
      <button
        type="button"
        onClick={toggle}
        disabled={saving}
        className="underline underline-offset-2 hover:text-foreground disabled:opacity-50 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t(optedOut ? 'contacts.optOut.turnOn' : 'contacts.optOut.turnOff')}
      </button>
    </p>
  );
}
