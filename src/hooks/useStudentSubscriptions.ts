import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { withTimeout } from '@/lib/utils';
import { pickPerUser, type SubscriptionRow } from '@/lib/subscriptionMetrics';

export interface SubscriptionSyncRun {
  id: string;
  trigger: 'cron' | 'manual';
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  rows_total: number | null;
  rows_matched: number | null;
  error: string | null;
}

export interface SyncResult { ok: boolean; error?: string }

// The generated types predate these tables; read them through an untyped view.
const db = supabase as unknown as SupabaseClient;

/**
 * Subscriptions synced from the customer-tracking sheet, plus the latest sync
 * run. Admin-only data (RLS) — pass enabled=false for anyone else so no request
 * is made. Failures stay inside this hook: the users table must keep working
 * when the dashboard can't load.
 */
export function useStudentSubscriptions(enabled: boolean) {
  const [rows, setRows] = useState<SubscriptionRow[]>([]);
  const [lastRun, setLastRun] = useState<SubscriptionSyncRun | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const [subsRes, runRes] = await withTimeout(
        Promise.all([
          db.from('student_subscriptions')
            .select('*')
            .order('sheet_row', { ascending: true }),
          db.from('subscription_sync_runs')
            .select('*')
            .order('started_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]),
        12000,
        'subscriptions',
      );
      if (subsRes.error) throw subsRes.error;
      if (runRes.error) throw runRes.error;
      setRows(
        ((subsRes.data ?? []) as SubscriptionRow[]).map((r) => ({
          ...r,
          // numeric columns can arrive as strings
          monthly_price: r.monthly_price === null ? null : Number(r.monthly_price),
        })),
      );
      setLastRun((runRes.data as SubscriptionSyncRun | null) ?? null);
    } catch (e) {
      console.error('Error loading subscriptions:', e);
      setError((e as Error)?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    load();
  }, [load]);

  const sync = useCallback(async (): Promise<SyncResult> => {
    setSyncing(true);
    try {
      const { data, error: invokeError } = await withTimeout(
        supabase.functions.invoke('sync-subscriptions-sheet', { body: { trigger: 'manual' } }),
        60000,
        'subscriptions sync',
      );
      if (invokeError) return { ok: false, error: 'internal_error' };
      await load();
      return data?.ok ? { ok: true } : { ok: false, error: data?.error ?? 'internal_error' };
    } catch {
      return { ok: false, error: 'internal_error' };
    } finally {
      setSyncing(false);
    }
  }, [load]);

  const byUserId = useMemo(() => pickPerUser(rows), [rows]);

  return { rows, byUserId, lastRun, loading, error, syncing, sync, reload: load };
}
