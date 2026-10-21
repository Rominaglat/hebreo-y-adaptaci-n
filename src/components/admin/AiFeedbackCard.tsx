import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Bot, ChevronDown, Loader2, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

interface AiFeedbackSummary {
  days: number;
  answers: number;
  up: number;
  down: number;
  recent_down: Array<{ rated_at: string; question: string | null; answer: string }>;
}

// admin_ai_feedback() predates the generated types.
const db = supabase as unknown as SupabaseClient;

/** 👍/👎 students gave Romina AI's answers — admin_ai_feedback() checks the caller is an admin. */
export function AiFeedbackCard() {
  const { t } = useLanguage();
  const [summary, setSummary] = useState<AiFeedbackSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void db.rpc('admin_ai_feedback', { _days: 30 }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { setFailed(true); return; }
      setSummary(data as AiFeedbackSummary);
    });
    return () => { cancelled = true; };
  }, []);

  if (failed) return null;

  const rated = summary ? summary.up + summary.down : 0;
  const helpfulPct = summary && rated > 0 ? Math.round((summary.up / rated) * 100) : null;

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Bot className="w-5 h-5 text-primary" />
        <h3 className="font-semibold">{t('surveys.ai.feedbackTitle')}</h3>
        <span className="text-xs text-muted-foreground">{t('surveys.ai.feedbackPeriod')}</span>
      </div>

      {!summary ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="tabular-nums">{t('surveys.ai.answers').replace('{n}', String(summary.answers))}</span>
            <span className="inline-flex items-center gap-1.5 tabular-nums text-success"><ThumbsUp className="w-4 h-4" />{summary.up}</span>
            <span className="inline-flex items-center gap-1.5 tabular-nums text-destructive"><ThumbsDown className="w-4 h-4" />{summary.down}</span>
            {helpfulPct !== null && (
              <span className="tabular-nums font-medium">{t('surveys.ai.helpful').replace('{pct}', String(helpfulPct))}</span>
            )}
          </div>
          {rated === 0 && <p className="text-xs text-muted-foreground">{t('surveys.ai.noRatings')}</p>}

          {summary.recent_down.length > 0 && (
            <Collapsible>
              <CollapsibleTrigger className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                {t('surveys.ai.recentDown').replace('{n}', String(summary.recent_down.length))}
                <ChevronDown className="w-4 h-4" />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-3">
                {summary.recent_down.map((item, i) => (
                  <div key={i} className="rounded-lg border border-border/60 p-3 text-sm space-y-1.5">
                    <p className="text-xs text-muted-foreground tabular-nums">{format(new Date(item.rated_at), 'd.M.yyyy HH:mm')}</p>
                    <p><span className="font-medium">{t('surveys.ai.question')}:</span> {item.question ?? '—'}</p>
                    <p className="text-muted-foreground whitespace-pre-wrap line-clamp-6"><span className="font-medium text-foreground">{t('surveys.ai.answer')}:</span> {item.answer}</p>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </>
      )}
    </Card>
  );
}
