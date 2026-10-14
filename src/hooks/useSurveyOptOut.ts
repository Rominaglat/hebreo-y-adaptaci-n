import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Opt-outs from the monthly survey WhatsApp reminder (migration
// 20261014100000_survey_reminder_optouts). RLS: a student reads / adds / removes
// only their own row; admins manage everyone's.

// 23505 = the row is already there (another tab, a double click): the wish is recorded.
const isDone = (error: { code?: string } | null) => !error || error.code === '23505';

/** The signed-in student's own opt-out. */
export function useOwnSurveyOptOut(userId: string | undefined) {
  const [optedOut, setOptedOut] = useState(false);
  const [loading, setLoading] = useState(!!userId);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let cancelled = false;
    void supabase
      .from('survey_reminder_optouts')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setOptedOut(!!data);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [userId]);

  const update = useCallback(async (next: boolean): Promise<boolean> => {
    if (!userId) return false;
    setSaving(true);
    const { error } = next
      ? await supabase.from('survey_reminder_optouts').insert({ user_id: userId, source: 'self', created_by: userId })
      : await supabase.from('survey_reminder_optouts').delete().eq('user_id', userId);
    setSaving(false);
    if (!isDone(error)) return false;
    setOptedOut(next);
    return true;
  }, [userId]);

  return { optedOut, loading, saving, update };
}

/** Admin: who has opted out, and opting any student out or back in. */
export function useSurveyOptOuts(enabled: boolean, adminId: string | undefined) {
  const [optedOutIds, setOptedOutIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void supabase
      .from('survey_reminder_optouts')
      .select('user_id')
      .then(({ data, error }) => {
        // Best-effort, like access_limits on the same page: a failure must not blank the users list.
        if (cancelled || error) return;
        setOptedOutIds(new Set((data ?? []).map((r) => r.user_id)));
      });
    return () => { cancelled = true; };
  }, [enabled]);

  const setOptOut = useCallback(async (userId: string, optOut: boolean): Promise<boolean> => {
    if (!adminId) return false;
    const { error } = optOut
      ? await supabase.from('survey_reminder_optouts').insert({ user_id: userId, source: 'admin', created_by: adminId })
      : await supabase.from('survey_reminder_optouts').delete().eq('user_id', userId);
    if (!isDone(error)) return false;
    setOptedOutIds((prev) => {
      const next = new Set(prev);
      if (optOut) next.add(userId); else next.delete(userId);
      return next;
    });
    return true;
  }, [adminId]);

  return { optedOutIds, setOptOut };
}
