import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export type OnboardingStep =
  | 'profile'
  | 'first_course'
  | 'first_lesson'
  | 'aria_chat'
  | 'study_room';

export interface OnboardingState {
  completed: boolean;
  startedAt: string | null;
  completedAt: string | null;
  finishedSteps: OnboardingStep[];
  dismissedChecklist: boolean;
  selectedInterests: string[];
}

const DEFAULT_STATE: OnboardingState = {
  completed: false,
  startedAt: null,
  completedAt: null,
  finishedSteps: [],
  dismissedChecklist: false,
  selectedInterests: [],
};

export const ONBOARDING_STEPS: { id: OnboardingStep; label: string; description: string; icon: string }[] = [
  {
    id: 'profile',
    label: 'השלמת הפרופיל',
    description: 'הוספת תמונה ופרטים אישיים',
    icon: '👤',
  },
  {
    id: 'first_course',
    label: 'הרשמה לקורס ראשון',
    description: 'בחירת קורס מעניין',
    icon: '📚',
  },
  {
    id: 'first_lesson',
    label: 'צפייה בשיעור הראשון',
    description: 'להתחיל ללמוד עכשיו',
    icon: '🎬',
  },
  {
    id: 'aria_chat',
    label: 'ניסיון של העוזר',
    description: 'העוזר החכם זמין לכל שאלה',
    icon: '🤖',
  },
  {
    id: 'study_room',
    label: 'הצטרף לחדר לימוד',
    description: 'למד יחד עם הקהילה',
    icon: '🎓',
  },
];

export function useOnboarding() {
  const { user } = useAuth();
  const storageKey = user ? `onboarding:${user.id}` : null;

  const [state, setState] = useState<OnboardingState>(DEFAULT_STATE);
  const [showFlow, setShowFlow] = useState(false);

  // Load
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const data = JSON.parse(raw) as OnboardingState;
        setState(data);
      } else {
        // First time — show flow
        setShowFlow(true);
      }
    } catch (e) {
      console.error('Failed to load onboarding', e);
    }
  }, [storageKey]);

  const persist = useCallback(
    (next: OnboardingState) => {
      if (!storageKey) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch (e) {
        console.error('Failed to save onboarding', e);
      }
    },
    [storageKey]
  );

  const startOnboarding = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, startedAt: prev.startedAt || new Date().toISOString() };
      persist(next);
      return next;
    });
    setShowFlow(true);
  }, [persist]);

  const finishOnboarding = useCallback(
    (interests: string[]) => {
      setState((prev) => {
        const next = {
          ...prev,
          completed: true,
          completedAt: new Date().toISOString(),
          selectedInterests: interests,
        };
        persist(next);
        return next;
      });
      setShowFlow(false);
    },
    [persist]
  );

  const skipOnboarding = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, completed: true, completedAt: new Date().toISOString() };
      persist(next);
      return next;
    });
    setShowFlow(false);
  }, [persist]);

  const completeStep = useCallback(
    (step: OnboardingStep) => {
      setState((prev) => {
        if (prev.finishedSteps.includes(step)) return prev;
        const next = { ...prev, finishedSteps: [...prev.finishedSteps, step] };
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const dismissChecklist = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, dismissedChecklist: true };
      persist(next);
      return next;
    });
  }, [persist]);

  const reopenChecklist = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, dismissedChecklist: false };
      persist(next);
      return next;
    });
  }, [persist]);

  const totalSteps = ONBOARDING_STEPS.length;
  const completedCount = state.finishedSteps.length;
  const progress = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0;
  const allDone = completedCount === totalSteps;

  return {
    state,
    showFlow,
    setShowFlow,
    startOnboarding,
    finishOnboarding,
    skipOnboarding,
    completeStep,
    dismissChecklist,
    reopenChecklist,
    progress,
    completedCount,
    totalSteps,
    allDone,
    steps: ONBOARDING_STEPS,
  };
}
