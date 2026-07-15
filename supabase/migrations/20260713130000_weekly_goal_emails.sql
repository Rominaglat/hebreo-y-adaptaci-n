-- Weekly goal email pipeline: per-week snapshot rows (history + idempotency +
-- trend/streak source) and a Monday-08:00 cron that invokes the
-- send-weekly-goal-summary edge function via pg_net.

CREATE TABLE IF NOT EXISTS public.weekly_goal_snapshots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start   date NOT NULL,                       -- Monday of the reviewed week
  unit         text NOT NULL,
  target       numeric NOT NULL,
  lessons_done int NOT NULL DEFAULT 0,
  minutes_done int NOT NULL DEFAULT 0,
  hours_done   numeric NOT NULL DEFAULT 0,
  pct          numeric NOT NULL DEFAULT 0,
  tier         text NOT NULL,
  sent_at      timestamptz,
  resend_id    text,
  email_status text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)                      -- idempotency: one send per week
);

CREATE INDEX IF NOT EXISTS idx_weekly_goal_snapshots_user ON public.weekly_goal_snapshots(user_id, week_start DESC);

ALTER TABLE public.weekly_goal_snapshots ENABLE ROW LEVEL SECURITY;

-- Students read their own history; only the service role (edge fn) writes.
DROP POLICY IF EXISTS weekly_goal_snapshots_select_own ON public.weekly_goal_snapshots;
CREATE POLICY weekly_goal_snapshots_select_own ON public.weekly_goal_snapshots
  FOR SELECT USING (auth.uid() = user_id);

-- Schedule the weekly summary (Monday 08:00) via pg_net, mirroring the
-- existing cleanup-empty-rooms schedule. The edge fn is idempotent
-- (unique per user+week), so an extra invocation never double-sends.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE
  service_url text := 'https://gmepopxxvgcwiqlkpuwd.supabase.co/functions/v1/send-weekly-goal-summary';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM 1 FROM cron.job WHERE jobname = 'invoke-weekly-goal-summary';
    IF NOT FOUND THEN
      PERFORM cron.schedule(
        'invoke-weekly-goal-summary',
        '0 8 * * 1',
        format(
          $cron$SELECT net.http_post(url := %L, headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb) AS request_id;$cron$,
          service_url
        )
      );
      RAISE NOTICE 'Scheduled invoke-weekly-goal-summary (Mon 08:00).';
    ELSE
      RAISE NOTICE 'invoke-weekly-goal-summary already scheduled — leaving as is.';
    END IF;
  ELSE
    RAISE NOTICE 'pg_cron not enabled — skipping weekly-goal-summary schedule.';
  END IF;
END$$;
