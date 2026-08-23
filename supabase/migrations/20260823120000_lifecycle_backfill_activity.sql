-- =============================================================================
-- Seed student_activity from evidence that already exists, so the win-back mail
-- is not sent on the basis of missing data.
--
-- WHY THIS IS REQUIRED BEFORE ENABLING THE CRON
-- ---------------------------------------------
-- The sweep treats "no last_active_at" as "last seen at signup". Activity
-- tracking only starts when the frontend ships, so on day one every student
-- looks dormant. A dry run against production showed 62 of 65 students would
-- have been told "hace varios días que no entro" — including 30 who had been
-- active that same week. That is not dormancy detection, it is absence of data.
--
-- The portal already records two truthful signals: a completed lesson, and the
-- 'login' row AuthContext writes on sign-in. Both are lower bounds on when the
-- student was last really here, so we seed from them.
--
-- Students with NO evidence at all (4 at the time of writing) are seeded with
-- now(). That direction is deliberate: we know nothing about them, and a
-- wrongly-sent "we miss you" note is worse than a week's delay. If they truly
-- are dormant, the sweep picks them up seven days from now.
-- =============================================================================

INSERT INTO public.student_activity (user_id, last_active_at)
SELECT p.id,
       COALESCE(
         GREATEST(
           (SELECT max(lc.completed_at) FROM public.lesson_completions lc WHERE lc.user_id = p.id),
           (SELECT max(ua.created_at)   FROM public.user_activities  ua WHERE ua.user_id = p.id)
         ),
         now()   -- no evidence either way: start the clock today
       )
  FROM public.profiles p
 WHERE p.deleted_at IS NULL
   AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)
ON CONFLICT (user_id) DO NOTHING;   -- never overwrite a real ping
