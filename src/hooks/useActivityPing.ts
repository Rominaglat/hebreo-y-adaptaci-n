import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PING_STORAGE_KEY, shouldPing } from '@/lib/activityPing';

/**
 * Records that the student opened the portal, at most once an hour.
 *
 * Feeds the 7-day win-back email. It has to be an explicit ping because the
 * client keeps sessions alive (persistSession + autoRefreshToken), so
 * auth.users.last_sign_in_at goes stale for students who visit every day.
 *
 * Writes through the touch_last_active() RPC rather than a table update: the
 * activity table is deny-all under RLS, so a student cannot forge the timestamp
 * to dodge the email.
 */
export function useActivityPing(userId: string | null | undefined) {
  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    const now = Date.now();

    let stored: string | null = null;
    try {
      stored = localStorage.getItem(PING_STORAGE_KEY);
    } catch {
      // Private mode / blocked storage: fall through and ping.
    }
    if (!shouldPing(stored, now)) return;

    void (async () => {
      const { error } = await supabase.rpc('touch_last_active');
      if (cancelled || error) return;
      try {
        localStorage.setItem(PING_STORAGE_KEY, String(now));
      } catch {
        // Not being able to remember costs an extra ping next load. Fine.
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);
}
