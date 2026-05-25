import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { Button } from '@/components/ui/button';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

type Step = 'welcome' | 'interests' | 'first_action';

export function OnboardingFlow() {
  const { showFlow, finishOnboarding, skipOnboarding } = useOnboarding();
  const { profile, tenantProfile } = useAuth();
  const { tenantSettings } = useTenant();
  const { t, isRTL } = useLanguage();
  const assistantName = tenantSettings?.ai_assistant_name?.trim() || 'Aria';
  const [step, setStep] = useState<Step>('welcome');
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);

  const INTERESTS = [
    { id: 'ai', label: t('onboarding.interest.ai'), emoji: '🤖' },
    { id: 'business', label: t('onboarding.interest.business'), emoji: '💼' },
    { id: 'marketing', label: t('onboarding.interest.marketing'), emoji: '📈' },
    { id: 'sales', label: t('onboarding.interest.sales'), emoji: '💰' },
    { id: 'product', label: t('onboarding.interest.product'), emoji: '🎯' },
    { id: 'design', label: t('onboarding.interest.design'), emoji: '🎨' },
    { id: 'dev', label: t('onboarding.interest.dev'), emoji: '💻' },
    { id: 'data', label: t('onboarding.interest.data'), emoji: '📊' },
    { id: 'content', label: t('onboarding.interest.content'), emoji: '✍️' },
    { id: 'leadership', label: t('onboarding.interest.leadership'), emoji: '🚀' },
  ];

  const firstName = ((tenantProfile?.full_name || profile?.full_name || '').trim().split(' ')[0]) || t('onboarding.fallbackName');

  const toggleInterest = (id: string) => {
    setSelectedInterests((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleNext = () => {
    if (step === 'welcome') setStep('interests');
    else if (step === 'interests') setStep('first_action');
  };

  const handleBack = () => {
    if (step === 'interests') setStep('welcome');
    else if (step === 'first_action') setStep('interests');
  };

  const handleFinish = () => {
    finishOnboarding(selectedInterests);
    setStep('welcome');
  };

  const handleSkip = () => {
    skipOnboarding();
    setStep('welcome');
  };

  const stepIndex = step === 'welcome' ? 0 : step === 'interests' ? 1 : 2;

  const ChevronNext = isRTL ? ChevronLeft : ChevronRight;
  const ChevronPrev = isRTL ? ChevronRight : ChevronLeft;

  return (
    <Dialog open={showFlow} onOpenChange={(open) => !open && handleSkip()}>
      <DialogContent className="max-w-lg p-0 overflow-hidden border-border/60 [&>button]:hidden">
        <VisuallyHidden>
          <DialogTitle>{t('onboarding.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('onboarding.dialogDescription')}</DialogDescription>
        </VisuallyHidden>
        <div className="relative">
          <div className="relative h-32 bg-gradient-to-br from-primary via-accent to-primary/80 overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.2),transparent_50%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_50%,rgba(255,255,255,0.15),transparent_50%)]" />
            <div className="absolute top-4 start-4">
              <div className="flex items-center gap-1.5">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className={cn(
                      'h-1.5 rounded-full transition-all',
                      i === stepIndex ? 'w-8 bg-white' : i < stepIndex ? 'w-6 bg-white/70' : 'w-6 bg-white/30'
                    )}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="absolute -bottom-10 inset-x-0 flex justify-center pointer-events-none">
            <div className="w-20 h-20 rounded-2xl bg-card shadow-xl flex items-center justify-center border-4 border-card">
              <Sparkles className="w-9 h-9 text-primary" />
            </div>
          </div>
        </div>

        <div className="px-6 pt-14 pb-6">
          <AnimatePresence mode="wait">
            {step === 'welcome' && (
              <motion.div
                key="welcome"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25 }}
                className="text-center space-y-3"
              >
                <h2 className="text-2xl font-bold tracking-tight">
                  {t('onboarding.welcomeTitle')}, <span className="text-gradient">{firstName}</span>! 🎉
                </h2>
                <p className="text-muted-foreground">{t('onboarding.welcomeBody')}</p>
                <div className="grid grid-cols-3 gap-3 pt-4">
                  {[
                    { emoji: '📚', label: t('onboarding.feature.courses') },
                    { emoji: '🤖', label: t('onboarding.feature.smartAi') },
                    { emoji: '🏆', label: t('onboarding.feature.achievements') },
                  ].map((f) => (
                    <div key={f.label} className="text-center p-3 rounded-xl bg-muted/50 border border-border/50">
                      <div className="text-2xl mb-1">{f.emoji}</div>
                      <p className="text-xs font-medium">{f.label}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {step === 'interests' && (
              <motion.div
                key="interests"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25 }}
                className="space-y-4"
              >
                <div className="text-center">
                  <h2 className="text-2xl font-bold tracking-tight">{t('onboarding.interestsTitle')}</h2>
                  <p className="text-muted-foreground text-sm mt-1">{t('onboarding.interestsSubtitle')}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {INTERESTS.map((interest) => {
                    const selected = selectedInterests.includes(interest.id);
                    return (
                      <button
                        key={interest.id}
                        type="button"
                        onClick={() => toggleInterest(interest.id)}
                        className={cn(
                          'relative flex items-center gap-2 p-3 rounded-xl border text-sm font-medium transition-all',
                          selected
                            ? 'bg-primary/10 border-primary text-foreground shadow-sm'
                            : 'bg-card border-border/60 hover:border-primary/40 hover:bg-primary/5'
                        )}
                      >
                        <span className="text-xl">{interest.emoji}</span>
                        <span className="flex-1 text-start">{interest.label}</span>
                        {selected && (
                          <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                            <Check className="w-3 h-3 text-primary-foreground" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {step === 'first_action' && (
              <motion.div
                key="first_action"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25 }}
                className="text-center space-y-4"
              >
                <h2 className="text-2xl font-bold tracking-tight">{t('onboarding.readyTitle')}</h2>
                <p className="text-muted-foreground text-sm">{t('onboarding.readyBody')}</p>
                <div className="bg-gradient-to-br from-primary/10 via-accent/5 to-transparent rounded-2xl p-5 space-y-3 border border-border/50">
                  {[
                    { icon: '👤', text: t('onboarding.task.profile') },
                    { icon: '📚', text: t('onboarding.task.discoverCourses') },
                    { icon: '🤖', text: t('onboarding.task.chatAssistant').replace('{name}', assistantName) },
                  ].map((item) => (
                    <div key={item.text} className="flex items-center gap-3 text-sm">
                      <span className="text-xl">{item.icon}</span>
                      <span className="flex-1 text-start font-medium">{item.text}</span>
                      <div className="w-5 h-5 rounded-full border-2 border-border" />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-between gap-2 mt-6 pt-4 border-t border-border/50">
            <Button variant="ghost" onClick={handleSkip} className="text-muted-foreground">
              {t('onboarding.skip')}
            </Button>
            <div className="flex items-center gap-2">
              {step !== 'welcome' && (
                <Button variant="outline" onClick={handleBack} size="sm">
                  <ChevronPrev className="w-4 h-4" />
                  {t('onboarding.back')}
                </Button>
              )}
              {step !== 'first_action' ? (
                <Button onClick={handleNext} className="gap-1.5 shadow-md shadow-primary/20">
                  {t('onboarding.next')}
                  <ChevronNext className="w-4 h-4" />
                </Button>
              ) : (
                <Button onClick={handleFinish} className="gap-1.5 shadow-md shadow-primary/20">
                  {t('onboarding.startCta')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
