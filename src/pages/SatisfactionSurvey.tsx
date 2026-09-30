import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { AlertCircle, CheckCircle2, Eye, Loader2, MessageSquareHeart, SendHorizonal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  ASPECT_LEVELS,
  ASPECTS,
  IMPROVEMENT_OPTIONS,
  OVERALL_LEVELS,
  TENURE_OPTIONS,
  TEXT_MAX,
  emptyDraft,
  missingFields,
  surveyPeriod,
  toInsertRow,
  toggleImprovement,
  type SurveyDraft,
  type SurveyField,
  type Tenure,
} from '@/lib/satisfactionSurvey';

// Monthly satisfaction survey. Not linked from the navigation — students reach it
// only through the dedicated link (/encuesta) the admins send out. One response
// per student per month (enforced by the DB); staff get a read-only preview.

type Status = 'loading' | 'form' | 'already' | 'thanks';

const optionClass = (selected: boolean) => cn(
  'flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer font-normal transition-colors hover:bg-muted/50',
  selected && 'border-primary bg-primary/5',
);

function Question({ field, title, required = true, error, children }: {
  field: string; title: string; required?: boolean; error?: boolean; children: ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <Card
      id={`q-${field}`}
      className={cn('p-5 sm:p-6 space-y-4 scroll-mt-24', error && 'border-destructive ring-1 ring-destructive/30')}
    >
      <h2 id={`q-${field}-label`} className="font-semibold leading-snug">
        {title}
        {required && <span className="text-destructive ms-1" aria-hidden>*</span>}
      </h2>
      {children}
      {error && (
        <p className="text-sm text-destructive flex items-center gap-1.5" role="alert">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {t('survey.answerRequired')}
        </p>
      )}
    </Card>
  );
}

function Done({ title, body }: { title: string; body: string }) {
  const { t } = useLanguage();
  return (
    <Card className="max-w-lg mx-auto p-8 sm:p-10 text-center space-y-4 border-t-4 border-t-primary">
      <CheckCircle2 className="w-14 h-14 mx-auto text-primary" />
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-muted-foreground">{body}</p>
      <Button asChild className="font-bold">
        <Link to="/dashboard">{t('survey.backHome')}</Link>
      </Button>
    </Card>
  );
}

export default function SatisfactionSurvey() {
  const { user, isAdminOrInstructor } = useAuth();
  const { t, isRTL } = useLanguage();
  const { toast } = useToast();
  // Radix radio groups default to dir="ltr" (no DirectionProvider in the app), which
  // would lay the scales out backwards in Hebrew — pass the page direction explicitly.
  const dir = isRTL ? 'rtl' : 'ltr';

  // Staff see exactly what students see, but cannot submit (keeps test answers
  // out of the data; the DB insert policy would reject them anyway).
  const preview = isAdminOrInstructor;

  const [status, setStatus] = useState<Status>('loading');
  const [draft, setDraft] = useState<SurveyDraft>(emptyDraft);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = `${t('survey.title')} | Hebreo y Adaptación`;
  }, [t]);

  useEffect(() => {
    if (!user) return;
    if (preview) { setStatus('form'); return; }
    let cancelled = false;
    void supabase
      .from('satisfaction_survey_responses')
      .select('id')
      .eq('user_id', user.id)
      .eq('period', surveyPeriod())
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        // On a read error show the form anyway — the UNIQUE(user_id, period)
        // constraint still stops a second response, and we handle that below.
        setStatus(!error && data ? 'already' : 'form');
      });
    return () => { cancelled = true; };
  }, [user, preview]);

  const missing = useMemo(() => new Set(missingFields(draft)), [draft]);
  const hasError = (f: SurveyField) => showErrors && missing.has(f);
  const update = (patch: Partial<SurveyDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (preview || !user || submitting) return;

    const miss = missingFields(draft);
    if (miss.length > 0) {
      setShowErrors(true);
      toast({ title: t('survey.missingAnswers'), variant: 'destructive' });
      document.getElementById(`q-${miss[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.from('satisfaction_survey_responses').insert(toInsertRow(draft, user.id));
    setSubmitting(false);

    if (!error) {
      setStatus('thanks');
    } else if (error.code === '23505') {
      // Already answered this month (another tab/device, or a double submit).
      setStatus('already');
    } else {
      toast({ title: t('survey.submitError'), variant: 'destructive' });
      return;
    }
    topRef.current?.scrollIntoView({ block: 'start' });
  };

  if (status === 'loading') {
    return <div className="flex justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (status === 'thanks') return <div ref={topRef}><Done title={t('survey.thanksTitle')} body={t('survey.thanksBody')} /></div>;
  if (status === 'already') return <div ref={topRef}><Done title={t('survey.alreadyTitle')} body={t('survey.alreadyBody')} /></div>;

  return (
    <div ref={topRef} className="max-w-2xl mx-auto pb-10">
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {preview && (
          <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
            <Eye className="w-4 h-4 mt-0.5 flex-shrink-0 text-primary" />
            <span>{t('survey.previewBanner')}</span>
          </div>
        )}

        <Card className="p-6 sm:p-8 space-y-3 border-t-4 border-t-primary">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageSquareHeart className="w-6 h-6 text-primary flex-shrink-0" /> {t('survey.title')}
          </h1>
          <p className="text-muted-foreground leading-relaxed">{t('survey.intro')}</p>
          <p className="text-xs text-destructive">{t('survey.requiredNote')}</p>
        </Card>

        {/* 1 — tenure */}
        <Question field="tenure" title={t('survey.q.tenure')} error={hasError('tenure')}>
          <RadioGroup
            value={draft.tenure ?? ''}
            onValueChange={(v) => update({ tenure: v as Tenure })}
            aria-labelledby="q-tenure-label"
            dir={dir}
            aria-required
          >
            {TENURE_OPTIONS.map((o) => (
              <Label key={o} htmlFor={`tenure-${o}`} className={optionClass(draft.tenure === o)}>
                <RadioGroupItem id={`tenure-${o}`} value={o} />
                {t(`survey.tenure.${o}`)}
              </Label>
            ))}
          </RadioGroup>
        </Question>

        {/* 2 — would recommend */}
        <Question field="wouldRecommend" title={t('survey.q.recommend')} error={hasError('wouldRecommend')}>
          <RadioGroup
            value={draft.wouldRecommend === null ? '' : draft.wouldRecommend ? 'yes' : 'no'}
            onValueChange={(v) => update({ wouldRecommend: v === 'yes' })}
            aria-labelledby="q-wouldRecommend-label"
            dir={dir}
            aria-required
            className="grid-cols-2"
          >
            {(['yes', 'no'] as const).map((o) => (
              <Label key={o} htmlFor={`recommend-${o}`} className={optionClass(draft.wouldRecommend === (o === 'yes'))}>
                <RadioGroupItem id={`recommend-${o}`} value={o} />
                {t(`survey.${o}`)}
              </Label>
            ))}
          </RadioGroup>
        </Question>

        {/* 3 — overall satisfaction, 1..5 */}
        <Question field="overall" title={t('survey.q.overall')} error={hasError('overall')}>
          <div className="space-y-2">
            <RadioGroupPrimitive.Root
              value={draft.overall === null ? '' : String(draft.overall)}
              onValueChange={(v) => update({ overall: Number(v) })}
              aria-labelledby="q-overall-label"
              dir={dir}
              aria-required
              className="grid grid-cols-5 gap-2"
            >
              {OVERALL_LEVELS.map((n) => (
                <RadioGroupPrimitive.Item
                  key={n}
                  value={String(n)}
                  aria-label={
                    n === 1 ? `1 — ${t('survey.overall.min')}`
                      : n === 5 ? `5 — ${t('survey.overall.max')}`
                        : String(n)
                  }
                  className={cn(
                    'h-12 flex items-center justify-center rounded-lg border text-lg font-semibold transition-colors hover:bg-muted/50',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
                  )}
                >
                  {n}
                </RadioGroupPrimitive.Item>
              ))}
            </RadioGroupPrimitive.Root>
            <div className="flex justify-between gap-4 text-xs text-muted-foreground">
              <span>{t('survey.overall.min')}</span>
              <span className="text-end">{t('survey.overall.max')}</span>
            </div>
          </div>
        </Question>

        {/* 4 — needs urgent improvement (checkboxes; "Nada" is exclusive) */}
        <Question field="needsImprovement" title={t('survey.q.improvement')} error={hasError('needsImprovement')}>
          <div role="group" aria-labelledby="q-needsImprovement-label" className="grid gap-2">
            {IMPROVEMENT_OPTIONS.map((o) => {
              const checked = draft.needsImprovement.includes(o);
              return (
                <Label key={o} htmlFor={`improvement-${o}`} className={optionClass(checked)}>
                  <Checkbox
                    id={`improvement-${o}`}
                    // Square corners: the theme radius makes rounded-sm look like a radio.
                    className="rounded-[4px]"
                    checked={checked}
                    onCheckedChange={() => update({ needsImprovement: toggleImprovement(draft.needsImprovement, o) })}
                  />
                  {t(`survey.improvement.${o}`)}
                </Label>
              );
            })}
          </div>
        </Question>

        {/* 5 — per-aspect rating grid, 1..4 */}
        <Question field="ratings" title={t('survey.q.aspects')} error={hasError('ratings')}>
          <div className="divide-y divide-border/60">
            {ASPECTS.map((a) => {
              const value = draft.ratings[a];
              const unrated = showErrors && value == null;
              return (
                <div key={a} className="py-4 first:pt-0 last:pb-0 space-y-2.5">
                  <p id={`aspect-${a}-label`} className={cn('text-sm font-medium', unrated && 'text-destructive')}>
                    {t(`survey.aspect.${a}`)}
                  </p>
                  <RadioGroupPrimitive.Root
                    value={value == null ? '' : String(value)}
                    onValueChange={(v) => update({ ratings: { ...draft.ratings, [a]: Number(v) } })}
                    aria-labelledby={`aspect-${a}-label`}
                    dir={dir}
                    aria-required
                    className="grid grid-cols-2 sm:grid-cols-4 gap-2"
                  >
                    {ASPECT_LEVELS.map((n) => (
                      <RadioGroupPrimitive.Item
                        key={n}
                        value={String(n)}
                        className={cn(
                          'min-h-10 flex items-center justify-center text-center rounded-lg border px-2 py-2 text-xs sm:text-[13px] leading-tight transition-colors hover:bg-muted/50',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                          'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:font-semibold',
                        )}
                      >
                        {t(`survey.level.${n}`)}
                      </RadioGroupPrimitive.Item>
                    ))}
                  </RadioGroupPrimitive.Root>
                </div>
              );
            })}
          </div>
        </Question>

        {/* 6–8 — open text */}
        <Question field="contribution" title={t('survey.q.contribution')} error={hasError('contribution')}>
          <Textarea
            rows={4}
            maxLength={TEXT_MAX}
            value={draft.contribution}
            onChange={(e) => update({ contribution: e.target.value })}
            placeholder={t('survey.answerPlaceholder')}
            aria-labelledby="q-contribution-label"
            aria-required
          />
        </Question>

        <Question field="suggestions" title={t('survey.q.suggestions')} error={hasError('suggestions')}>
          <Textarea
            rows={4}
            maxLength={TEXT_MAX}
            value={draft.suggestions}
            onChange={(e) => update({ suggestions: e.target.value })}
            placeholder={t('survey.answerPlaceholder')}
            aria-labelledby="q-suggestions-label"
            aria-required
          />
        </Question>

        <Question field="comments" title={t('survey.q.comments')} required={false}>
          <Textarea
            rows={3}
            maxLength={TEXT_MAX}
            value={draft.comments}
            onChange={(e) => update({ comments: e.target.value })}
            placeholder={t('survey.answerPlaceholder')}
            aria-labelledby="q-comments-label"
          />
        </Question>

        <Button type="submit" size="lg" className="w-full sm:w-auto font-bold" disabled={preview || submitting}>
          {submitting
            ? <><Loader2 className="w-4 h-4 me-2 animate-spin" /> {t('survey.submitting')}</>
            : <><SendHorizonal className="w-4 h-4 me-2 rtl:rotate-180" /> {t('survey.submit')}</>}
        </Button>
      </form>
    </div>
  );
}
