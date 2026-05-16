import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Answer, PersonalityAssessment } from '@/lib/personality/types';
import { QUESTIONS_VERSION } from '@/lib/personality/questions';

interface SubmitError {
  code: 'cooldown_active' | 'ai_unavailable' | 'validation' | 'unknown';
  message: string;
  next_available_at?: string;
}

interface CooldownState {
  active: boolean;
  next_available_at: string | null;
  days_remaining: number;
}

export function usePersonalityAssessment() {
  const { user } = useAuth();
  const [latest, setLatest] = useState<PersonalityAssessment | null>(null);
  const [history, setHistory] = useState<PersonalityAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<SubmitError | null>(null);

  const fetchAll = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Skip rows that an admin has voided — they remain in DB for audit but
      // shouldn't appear in the student's report or history.
      const { data, error: fetchError } = await supabase
        .from('personality_assessments')
        .select('*')
        .eq('user_id', user.id)
        .is('voided_at', null)
        .order('created_at', { ascending: false });
      if (fetchError) throw fetchError;
      const rows = (data ?? []) as unknown as PersonalityAssessment[];
      setHistory(rows);
      setLatest(rows[0] ?? null);
    } catch (e) {
      console.error('Failed to fetch personality assessments', e);
      setHistory([]);
      setLatest(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const fetchById = useCallback(
    async (id: string): Promise<PersonalityAssessment | null> => {
      const { data, error: fetchError } = await supabase
        .from('personality_assessments')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (fetchError) {
        console.error('Failed to fetch assessment by id', fetchError);
        return null;
      }
      return (data as unknown as PersonalityAssessment) ?? null;
    },
    [],
  );

  const submit = useCallback(
    async (answers: Answer[]): Promise<PersonalityAssessment | null> => {
      if (!user) return null;
      setSubmitting(true);
      setError(null);
      try {
        const { data, error: fnError } = await supabase.functions.invoke(
          'analyze-personality',
          { body: { version: QUESTIONS_VERSION, answers } },
        );
        if (fnError) {
          // Edge function returned non-2xx; try to extract structured error from context.
          // deno-lint-ignore no-explicit-any
          const ctx = (fnError as any)?.context;
          let code: SubmitError['code'] = 'unknown';
          let message = fnError.message;
          let next_available_at: string | undefined;
          try {
            const text = await ctx?.text?.();
            if (text) {
              const parsed = JSON.parse(text);
              if (parsed.error === 'cooldown_active') {
                code = 'cooldown_active';
                next_available_at = parsed.next_available_at;
                message = `יש להמתין עד ${parsed.next_available_at}`;
              } else if (parsed.error === 'ai_unavailable') {
                code = 'ai_unavailable';
                message = 'השירות עמוס כרגע, נסו שוב בעוד דקה';
              } else if (typeof parsed.error === 'string' && parsed.error.startsWith('validation:')) {
                code = 'validation';
                message = parsed.error;
              }
            }
          } catch {
            // fall through with default
          }
          const errObj: SubmitError = { code, message, next_available_at };
          setError(errObj);
          throw errObj;
        }
        if (data?.error) {
          const errObj: SubmitError = { code: 'unknown', message: String(data.error) };
          setError(errObj);
          throw errObj;
        }
        const row = data as unknown as PersonalityAssessment;
        setLatest(row);
        setHistory((prev) => [row, ...prev]);
        return row;
      } finally {
        setSubmitting(false);
      }
    },
    [user],
  );

  const cooldown: CooldownState = (() => {
    if (!latest) return { active: false, next_available_at: null, days_remaining: 0 };
    const created = new Date(latest.created_at).getTime();
    const ms = Date.now() - created;
    const windowMs = 7 * 24 * 60 * 60 * 1000;
    const active = ms < windowMs;
    if (!active) return { active: false, next_available_at: null, days_remaining: 0 };
    const next = new Date(created + windowMs);
    const daysRemaining = Math.ceil((windowMs - ms) / (24 * 60 * 60 * 1000));
    return { active: true, next_available_at: next.toISOString(), days_remaining: daysRemaining };
  })();

  return {
    latest,
    history,
    loading,
    submitting,
    error,
    cooldown,
    submit,
    fetchById,
    refetch: fetchAll,
  };
}
