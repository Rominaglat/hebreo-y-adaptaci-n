import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOwnSurveyOptOut } from '@/hooks/useSurveyOptOut';

/**
 * Footer line on the survey page: lets a student stop (and restart) the monthly
 * WhatsApp reminder themselves. The WhatsApp template can't carry a per-student
 * unsubscribe link without Meta re-approving it, so the opt-out lives here,
 * one tap from the link the reminder points to.
 */
export function SurveyReminderOptOut() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { toast } = useToast();
  const { optedOut, loading, saving, update } = useOwnSurveyOptOut(user?.id);

  if (!user || loading) return null;

  const toggle = async () => {
    const next = !optedOut;
    const ok = await update(next);
    toast(ok
      ? { title: t(next ? 'survey.optOut.savedOff' : 'survey.optOut.savedOn') }
      : { title: t('survey.optOut.error'), variant: 'destructive' });
  };

  return (
    <p className="text-xs text-muted-foreground text-center leading-relaxed">
      {t(optedOut ? 'survey.optOut.isOff' : 'survey.optOut.question')}{' '}
      <button
        type="button"
        onClick={toggle}
        disabled={saving}
        className="underline underline-offset-2 hover:text-foreground disabled:opacity-50 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t(optedOut ? 'survey.optOut.turnOn' : 'survey.optOut.turnOff')}
      </button>
    </p>
  );
}
