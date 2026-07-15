import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  computeWeeklyProgress, startOfIsoWeek, DEFAULT_LESSON_MINUTES,
  type GoalUnit, type Progress,
} from '@/lib/weeklyGoal';

interface GoalRow { unit: GoalUnit; target: number; emailsEnabled: boolean }

export interface WeeklyGoalState {
  goal: GoalRow | null;
  progress: Progress | null;
  defaultLessonMinutes: number;
  loading: boolean;
}

export function useWeeklyGoal() {
  const { user } = useAuth();
  const [state, setState] = useState<WeeklyGoalState>({
    goal: null, progress: null, defaultLessonMinutes: DEFAULT_LESSON_MINUTES, loading: true,
  });

  const reload = useCallback(async () => {
    if (!user) { setState(s => ({ ...s, loading: false })); return; }
    setState(s => ({ ...s, loading: true }));

    const [{ data: goalRow }, { data: settings }] = await Promise.all([
      supabase.from('student_goals').select('unit, target, emails_enabled').eq('user_id', user.id).maybeSingle(),
      supabase.from('tenant_settings').select('default_lesson_minutes').maybeSingle(),
    ]);
    const defMin = settings?.default_lesson_minutes ?? DEFAULT_LESSON_MINUTES;

    let progress: Progress | null = null;
    let goal: GoalRow | null = null;
    if (goalRow) {
      goal = { unit: goalRow.unit, target: Number(goalRow.target), emailsEnabled: goalRow.emails_enabled };
      const weekStart = startOfIsoWeek(new Date());
      const { data: completions } = await supabase
        .from('lesson_completions')
        .select('lesson_id, completed_at, lessons(duration_minutes)')
        .eq('user_id', user.id)
        .gte('completed_at', weekStart.toISOString());
      const items = (completions ?? []).map((c) => {
        const lessons = (c as { lessons: { duration_minutes: number | null } | { duration_minutes: number | null }[] | null }).lessons;
        const dur = Array.isArray(lessons) ? lessons[0]?.duration_minutes : lessons?.duration_minutes;
        return { durationMinutes: dur ?? null };
      });
      progress = computeWeeklyProgress(items, { unit: goal.unit, target: goal.target }, defMin);
    }
    setState({ goal, progress, defaultLessonMinutes: defMin, loading: false });
  }, [user]);

  useEffect(() => { void reload(); }, [reload]);

  const saveGoal = useCallback(async (unit: GoalUnit, target: number, emailsEnabled: boolean) => {
    if (!user) return;
    await supabase.from('student_goals').upsert(
      { user_id: user.id, unit, target, emails_enabled: emailsEnabled },
      { onConflict: 'user_id' },
    );
    await reload();
  }, [user, reload]);

  const setEmailsEnabled = useCallback(async (v: boolean) => {
    if (!user) return;
    await supabase.from('student_goals').update({ emails_enabled: v }).eq('user_id', user.id);
    await reload();
  }, [user, reload]);

  return { ...state, saveGoal, setEmailsEnabled, reload };
}
