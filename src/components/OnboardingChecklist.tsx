import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Check, X, ChevronUp, Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useOnboarding, type OnboardingStep } from '@/hooks/useOnboarding';
import { useTenant } from '@/contexts/TenantContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

const STEP_LINKS: Record<OnboardingStep, string> = {
  profile: '/profile',
  first_course: '/courses',
  first_lesson: '/courses',
  aria_chat: '/dashboard',
  study_room: '/study-rooms',
};

export function OnboardingChecklist() {
  const {
    state,
    steps,
    progress,
    completedCount,
    totalSteps,
    allDone,
    dismissChecklist,
  } = useOnboarding();
  const { tenantSettings } = useTenant();
  const { t } = useLanguage();
  const assistantName = tenantSettings?.ai_assistant_name?.trim() || 'Aria';
  const [expanded, setExpanded] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );

  const getStepLabel = (step: typeof steps[number]): string => {
    const base = t(step.labelKey);
    if (step.id === 'aria_chat') return base.replace('{name}', assistantName);
    return base;
  };

  const getStepDescription = (step: typeof steps[number]): string => t(step.descriptionKey);

  if (!state.completed) return null;
  if (state.dismissedChecklist) return null;
  if (allDone) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 22 }}
      className="fixed bottom-6 start-6 z-[60] max-w-[calc(100vw-3rem)] w-[340px]"
    >
      <Card className="overflow-hidden border-border/60 shadow-2xl shadow-primary/10 backdrop-blur-xl bg-card/95">
        <div className="w-full flex items-center gap-3 p-4 hover:bg-muted/40 transition-colors">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? t('onboardingChecklist.collapseAria') : t('onboardingChecklist.expandAria')}
            className="flex flex-1 items-center gap-3 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-md"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-md shadow-primary/20 flex-shrink-0">
              <Sparkles className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold tracking-tight">{t('onboardingChecklist.title')}</p>
              <p className="text-xs text-muted-foreground">
                {t('onboardingChecklist.progress').replace('{done}', String(completedCount)).replace('{total}', String(totalSteps))}
              </p>
            </div>
            <motion.div animate={{ rotate: expanded ? 0 : 180 }} transition={{ duration: 0.2 }}>
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            </motion.div>
          </button>
          <button
            type="button"
            onClick={dismissChecklist}
            className="w-7 h-7 rounded-md hover:bg-muted flex items-center justify-center transition-colors flex-shrink-0"
            aria-label={t('common.close')}
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        <div className="px-4 -mt-1 pb-3">
          <Progress value={progress} className="h-1.5" />
        </div>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.33, 1, 0.68, 1] }}
              className="overflow-hidden"
            >
              <CardContent className="px-3 pb-3 pt-0 space-y-1">
                {steps.map((step) => {
                  const done = state.finishedSteps.includes(step.id);
                  return (
                    <Link
                      key={step.id}
                      to={STEP_LINKS[step.id]}
                      className={cn(
                        'flex items-center gap-3 p-2.5 rounded-lg transition-colors group',
                        done ? 'opacity-60' : 'hover:bg-primary/5'
                      )}
                    >
                      <div
                        className={cn(
                          'w-7 h-7 rounded-lg flex items-center justify-center text-base flex-shrink-0 transition-all',
                          done
                            ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-sm'
                            : 'bg-muted group-hover:bg-primary/10'
                        )}
                      >
                        {done ? (
                          <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                        ) : (
                          <span>{step.icon}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className={cn(
                            'text-sm font-medium truncate',
                            done && 'line-through text-muted-foreground'
                          )}
                        >
                          {getStepLabel(step)}
                        </p>
                        {!done && (
                          <p className="text-xs text-muted-foreground truncate">{getStepDescription(step)}</p>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}
