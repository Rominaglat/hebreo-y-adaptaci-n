import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { ContactSuppression } from '@/lib/contactSuppression';

// The do-not-contact list (migration 20261015100000_contact_suppressions).
// RLS: a student reads / adds / removes only their own account-level entry;
// admins manage every entry, including phones and emails of non-users.

// 23505 = already on the list (another tab, a double click): the wish is recorded.
const isDone = (error: { code?: string } | null) => !error || error.code === '23505';

/** The signed-in student's own entry: "send me nothing". */
export function useOwnContactOptOut(userId: string | undefined) {
  const [optedOut, setOptedOut] = useState(false);
  const [loading, setLoading] = useState(!!userId);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let cancelled = false;
    void supabase
      .from('contact_suppressions')
      .select('id')
      .eq('user_id', userId)
      .then(({ data }) => {
        if (cancelled) return;
        setOptedOut((data ?? []).length > 0);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [userId]);

  const update = useCallback(async (next: boolean): Promise<boolean> => {
    if (!userId) return false;
    setSaving(true);
    const { error } = next
      ? await supabase.from('contact_suppressions').insert({ user_id: userId, source: 'self', created_by: userId })
      : await supabase.from('contact_suppressions').delete().eq('user_id', userId);
    setSaving(false);
    if (!isDone(error)) return false;
    setOptedOut(next);
    return true;
  }, [userId]);

  return { optedOut, loading, saving, update };
}

export interface NewSuppression { userId?: string; phone?: string; email?: string; reason?: string }

/** Admin: the whole list, adding by account / phone / email, and removing entries. */
export function useContactSuppressions(enabled: boolean, adminId: string | undefined) {
  const [entries, setEntries] = useState<ContactSuppression[]>([]);

  const load = useCallback(async () => {
    if (!enabled) return;
    const { data, error } = await supabase
      .from('contact_suppressions')
      .select('*')
      .order('created_at', { ascending: false });
    // Best-effort, like access_limits on the same page: a failure must not blank the users list.
    if (!error) setEntries((data ?? []) as ContactSuppression[]);
  }, [enabled]);

  useEffect(() => { void load(); }, [load]);

  const add = useCallback(async ({ userId, phone, email, reason }: NewSuppression): Promise<boolean> => {
    if (!adminId) return false;
    const row = {
      user_id: userId ?? null,
      phone: phone?.trim() || null,
      email: email?.trim() || null,
      reason: reason?.trim() || null,
      source: 'admin' as const,
      created_by: adminId,
    };
    const { error } = await supabase.from('contact_suppressions').insert(row);
    if (!isDone(error)) return false;
    await load();
    return true;
  }, [adminId, load]);

  const remove = useCallback(async (ids: string[]): Promise<boolean> => {
    if (ids.length === 0) return true;
    const { error } = await supabase.from('contact_suppressions').delete().in('id', ids);
    if (error) return false;
    setEntries((prev) => prev.filter((e) => !ids.includes(e.id)));
    return true;
  }, []);

  return { entries, add, remove, reload: load };
}
