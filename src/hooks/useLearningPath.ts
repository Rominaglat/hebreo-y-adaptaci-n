import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface LearningStep {
  course_id: string;
  course_title: string;
  reason: string;
}

export interface LearningPath {
  id: string;
  user_id: string;
  goal: string;
  steps: LearningStep[];
  current_step: number;
  created_at: string;
  updated_at: string;
}

export function useLearningPath() {
  const { user } = useAuth();
  const [path, setPath] = useState<LearningPath | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPath = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error: fetchError } = await supabase
        .from('learning_paths')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (fetchError) throw fetchError;
      setPath(data as LearningPath | null);
    } catch (e) {
      console.error('Failed to fetch learning path', e);
      setPath(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchPath();
  }, [fetchPath]);

  const generate = useCallback(
    async (goal: string) => {
      if (!user) return;
      setGenerating(true);
      setError(null);
      try {
        const { data, error: fnError } = await supabase.functions.invoke(
          'generate-learning-path',
          { body: { goal } }
        );
        if (fnError) throw fnError;
        if (data?.error) throw new Error(data.error);
        setPath(data as LearningPath);
        return data as LearningPath;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        setError(msg);
        throw e;
      } finally {
        setGenerating(false);
      }
    },
    [user]
  );

  const advanceStep = useCallback(async () => {
    if (!path) return;
    const next = Math.min(path.current_step + 1, path.steps.length);
    const { error: updateError } = await supabase
      .from('learning_paths')
      .update({ current_step: next })
      .eq('id', path.id);
    if (!updateError) {
      setPath({ ...path, current_step: next });
    }
  }, [path]);

  const reset = useCallback(async () => {
    if (!path) return;
    const { error: deleteError } = await supabase
      .from('learning_paths')
      .delete()
      .eq('id', path.id);
    if (!deleteError) setPath(null);
  }, [path]);

  return {
    path,
    loading,
    generating,
    error,
    generate,
    advanceStep,
    reset,
    refetch: fetchPath,
  };
}
