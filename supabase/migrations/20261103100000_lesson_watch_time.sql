-- Real watch time per lesson, so rewatching a lesson counts as study time.
--
-- Until now weekly "hours" were derived only from lesson_completions, which
-- holds one row per (user, lesson): a student who rewatched a lesson three
-- times got credit once. The player now reports the seconds a video actually
-- played, and the weekly summary credits each lesson the larger of its
-- completion credit and its measured watch time.
--
-- Data class: per-user. The owner and staff read it; nobody writes it
-- directly. Every write goes through record_lesson_watch_time(), which can
-- never credit more seconds than have passed on the wall clock, so a student
-- cannot forge hours by calling the API.

-- ─── lesson_watch_time: seconds played, one row per user/lesson/UTC day ───
CREATE TABLE IF NOT EXISTS public.lesson_watch_time (
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id  uuid        NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  watched_on date        NOT NULL,                 -- UTC day, matching the UTC weeks of the summary email
  seconds    int         NOT NULL DEFAULT 0 CHECK (seconds >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id, watched_on)
);

CREATE INDEX IF NOT EXISTS idx_lesson_watch_time_week
  ON public.lesson_watch_time (watched_on, user_id);

ALTER TABLE public.lesson_watch_time ENABLE ROW LEVEL SECURITY;

-- Students read their own time; admins/instructors read everyone's (the
-- student progress dialog). Same audience as lesson_completions.
DROP POLICY IF EXISTS lesson_watch_time_select_own ON public.lesson_watch_time;
CREATE POLICY lesson_watch_time_select_own
  ON public.lesson_watch_time
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid()
         OR EXISTS (
           SELECT 1 FROM public.user_roles
           WHERE user_id = auth.uid()
             AND role IN ('admin', 'super_admin', 'instructor')
         ));

-- No INSERT/UPDATE/DELETE policy: direct writes are denied by RLS. Revoke the
-- table privileges too, so the denial doesn't hang on RLS alone.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.lesson_watch_time FROM anon, authenticated;
REVOKE ALL ON public.lesson_watch_time FROM anon;

-- ─── lesson_watch_clock: how much wall-clock time has been credited ───────
-- One row per student. credited_until only moves forward by the seconds it
-- grants, and never sits more than 90 s behind now(): a call can claim at
-- most the real time that has passed since the last credit, plus a 90 s bank
-- for the first heartbeat after a pause. Two tabs playing at once share the
-- same clock, so they can't double the time either.
CREATE TABLE IF NOT EXISTS public.lesson_watch_clock (
  user_id        uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  credited_until timestamptz NOT NULL
);

-- Internal bookkeeping: RLS on with no policies, so only the definer function
-- and the service role touch it.
ALTER TABLE public.lesson_watch_clock ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lesson_watch_clock FROM anon, authenticated;

-- ─── record_lesson_watch_time ─────────────────────────────────────────────
-- Called by the lesson player every ~30 s while a video plays (and on pause).
-- Returns the seconds actually credited. Acts only on the caller's own rows
-- and returns nothing but that number.
CREATE OR REPLACE FUNCTION public.record_lesson_watch_time(
  p_lesson_id uuid,
  p_seconds   int
)
RETURNS int
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_now    timestamptz := now();
  v_bank   interval := interval '90 seconds';
  v_clock  timestamptz;
  v_credit int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_lesson_id IS NULL OR p_seconds IS NULL OR p_seconds <= 0 THEN
    RETURN 0;
  END IF;
  -- Only a lesson the caller is allowed to open earns time.
  IF NOT public.is_lesson_unlocked(p_lesson_id, v_uid) THEN
    RETURN 0;
  END IF;

  -- Lock the caller's clock row so concurrent heartbeats serialize.
  INSERT INTO public.lesson_watch_clock (user_id, credited_until)
  VALUES (v_uid, v_now - v_bank)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT credited_until INTO v_clock
  FROM public.lesson_watch_clock
  WHERE user_id = v_uid
  FOR UPDATE;

  v_clock  := GREATEST(v_clock, v_now - v_bank);
  v_credit := LEAST(p_seconds, FLOOR(EXTRACT(EPOCH FROM (v_now - v_clock)))::int);
  IF v_credit <= 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.lesson_watch_clock
  SET credited_until = v_clock + make_interval(secs => v_credit)
  WHERE user_id = v_uid;

  INSERT INTO public.lesson_watch_time (user_id, lesson_id, watched_on, seconds, updated_at)
  VALUES (v_uid, p_lesson_id, (v_now AT TIME ZONE 'UTC')::date, v_credit, v_now)
  ON CONFLICT (user_id, lesson_id, watched_on) DO UPDATE
    SET seconds    = public.lesson_watch_time.seconds + EXCLUDED.seconds,
        updated_at = EXCLUDED.updated_at;

  RETURN v_credit;
END;
$$;

REVOKE ALL ON FUNCTION public.record_lesson_watch_time(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_lesson_watch_time(uuid, int) TO authenticated;

COMMENT ON FUNCTION public.record_lesson_watch_time(uuid, int) IS
  'Credits seconds of video playback to the caller, never more than the wall-clock time elapsed since their last credit.';
