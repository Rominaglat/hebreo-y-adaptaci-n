import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, ArrowLeft, Loader2, Sparkles, Brain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { usePersonalityAssessment } from '@/hooks/usePersonalityAssessment';
import { QuestionCard } from '@/components/personality/QuestionCard';
import { ProgressDots } from '@/components/personality/ProgressDots';
import { QUESTIONS, QUESTIONS_VERSION } from '@/lib/personality/questions';
import type { Answer } from '@/lib/personality/types';
import PersonalityResultsView from './PersonalityResultsView';
import { cn } from '@/lib/utils';

const STORAGE_KEY = `personality:answers:v${QUESTIONS_VERSION}`;

type Mode = 'results' | 'wizard' | 'submitting';

function isComplete(a: Answer | undefined): boolean {
  if (!a) return false;
  if (a.type === 'likert') return typeof a.value === 'number';
  return Boolean(a.most);
}

export default function PersonalityAssessment() {
  const { latest, loading, submitting, submit, error, cooldown } = usePersonalityAssessment();
  const { toast } = useToast();

  const [mode, setMode] = useState<Mode | null>(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (loading || mode !== null) return;
    setMode(latest ? 'results' : 'wizard');
  }, [loading, latest, mode]);

  useEffect(() => {
    if (submitting) setMode('submitting');
  }, [submitting]);

  useEffect(() => {
    if (mode !== 'wizard') return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(answers));
    } catch {
      /* ignore quota errors */
    }
  }, [answers, mode]);

  const total = QUESTIONS.length;
  const currentQuestion = QUESTIONS[step];
  const currentAnswer = currentQuestion ? answers[currentQuestion.qid] : undefined;

  const isAnswered = useMemo(() => isComplete(currentAnswer), [currentAnswer]);
  const answeredCount = useMemo(
    () => QUESTIONS.filter((q) => isComplete(answers[q.qid])).length,
    [answers],
  );
  const allAnswered = answeredCount === total;

  const handleAnswer = (a: Answer) => {
    setAnswers((prev) => ({ ...prev, [a.qid]: a }));
  };

  const goNext = () => {
    if (!isAnswered) return;
    if (step < total - 1) setStep(step + 1);
  };
  const goBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleSubmit = async () => {
    if (!allAnswered) {
      toast({
        title: 'נדרש להשלים את כל השאלות',
        description: `נותרו ${total - answeredCount} שאלות לסיום`,
        variant: 'destructive',
      });
      return;
    }
    try {
      const orderedAnswers: Answer[] = QUESTIONS.map((q) => answers[q.qid]);
      await submit(orderedAnswers);
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* noop */
      }
      setAnswers({});
      setStep(0);
      setMode('results');
      toast({ title: 'הניתוח מוכן' });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      const message = (e as { message?: string })?.message ?? 'שגיאה בהפקת הניתוח';
      if (code === 'cooldown_active') {
        toast({ title: 'יש להמתין', description: message, variant: 'destructive' });
        setMode('results');
      } else {
        toast({ title: 'שגיאה', description: message, variant: 'destructive' });
        setMode('wizard');
      }
    }
  };

  const startNewAssessment = () => {
    setAnswers({});
    setStep(0);
    setMode('wizard');
  };

  // ─── render ──────────────────────────────────────────────────────────

  if (loading || mode === null) {
    return (
      <div className="space-y-6 max-w-3xl mx-auto">
        <Skeleton className="h-40 rounded-3xl" />
        <Skeleton className="h-72 rounded-3xl" />
      </div>
    );
  }

  if (mode === 'submitting') {
    return <SubmittingState />;
  }

  if (mode === 'results') {
    return <PersonalityResultsView onRetake={startNewAssessment} />;
  }

  // ─── wizard ──────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto space-y-5 pb-32 sm:pb-6">
      <header className="relative overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-primary/[0.08] via-card to-accent/[0.06] p-6 sm:p-8">
        <div className="absolute -top-20 -end-20 w-64 h-64 rounded-full bg-primary/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -start-20 w-72 h-72 rounded-full bg-accent/10 blur-3xl pointer-events-none" />
        <div className="relative flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/20 shrink-0">
            <Brain className="w-6 h-6 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              שאלון פרופיל אישיותי · ~6 דקות
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold leading-tight tracking-tight text-foreground">
              להכיר את עצמך לפני שמובילים את העסק
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground leading-relaxed max-w-xl">
              שאלון אישיות בסיומו מתקבל ניתוח AI מקיף עם פילוח תפקידים וסגנון תקשורת — מיועד לפעולה.
            </p>
          </div>
        </div>
      </header>

      <div className="rounded-3xl border border-border/70 bg-card p-5 sm:p-7 space-y-7">
        <ProgressDots current={step + 1} total={total} />

        {cooldown.active && latest && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm">
            <span className="mt-1 w-2 h-2 rounded-full bg-amber-500 shrink-0" />
            <div>
              ניתן לשמור תוצאה חדשה רק בעוד {cooldown.days_remaining} ימים. מילוי השאלון אפשרי, אבל השמירה לא תתאפשר.
            </div>
          </div>
        )}

        <AnimatePresence mode="wait">
          {currentQuestion && (
            <QuestionCard
              key={currentQuestion.qid}
              question={currentQuestion}
              answer={currentAnswer}
              onAnswer={handleAnswer}
            />
          )}
        </AnimatePresence>

        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <span className="mt-1 w-2 h-2 rounded-full bg-destructive shrink-0" />
            <div>שגיאה: {error.message}</div>
          </div>
        )}
      </div>

      <div
        className={cn(
          'flex items-center justify-between gap-3',
          'sm:relative sm:p-0 sm:bg-transparent sm:border-0',
          'fixed bottom-0 inset-x-0 p-3 bg-background/85 backdrop-blur-md border-t border-border/70 z-30',
        )}
      >
        <Button variant="outline" onClick={goBack} disabled={step === 0} size="lg">
          <ArrowRight className="w-4 h-4 me-1.5" />
          הקודם
        </Button>

        {step < total - 1 ? (
          <Button
            onClick={goNext}
            disabled={!isAnswered}
            size="lg"
            className="bg-gradient-to-l from-primary to-accent text-primary-foreground hover:opacity-95"
          >
            הבא
            <ArrowLeft className="w-4 h-4 ms-1.5" />
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={!allAnswered || submitting}
            size="lg"
            className="bg-gradient-to-l from-primary to-accent text-primary-foreground hover:opacity-95 shadow-lg shadow-primary/25"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 me-1.5 animate-spin" />
                מנתח...
              </>
            ) : (
              <>
                סיים וקבל ניתוח
                <Sparkles className="w-4 h-4 ms-1.5" />
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

function SubmittingState() {
  return (
    <div className="max-w-2xl mx-auto pt-8">
      <div className="relative overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-primary/10 via-card to-accent/[0.07] p-12 text-center">
        <div className="absolute -top-20 -end-20 w-64 h-64 rounded-full bg-primary/20 blur-3xl pointer-events-none animate-pulse" />
        <div className="absolute -bottom-20 -start-20 w-64 h-64 rounded-full bg-accent/15 blur-3xl pointer-events-none animate-pulse" />
        <div className="relative space-y-5">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, ease: [0.33, 1, 0.68, 1] }}
            className="w-16 h-16 rounded-2xl mx-auto bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-xl shadow-primary/30"
          >
            <Loader2 className="w-8 h-8 text-primary-foreground animate-spin" />
          </motion.div>
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              עיבוד תשובות
            </div>
            <h2 className="text-2xl font-extrabold tracking-tight text-foreground">
              המערכת מנתחת את הפרופיל
            </h2>
            <p className="text-muted-foreground max-w-sm mx-auto leading-relaxed">
              חישוב הציונים, התאמה למודלי האישיות, וכתיבת הניתוח האיכותני. ייקח מספר דקות.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
