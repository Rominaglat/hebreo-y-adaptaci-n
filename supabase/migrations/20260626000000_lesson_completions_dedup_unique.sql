-- lesson_completions had no unique constraint (surrogate id PK only), so a
-- lesson could accumulate multiple completion rows for the same user. This
-- happened in prod (e.g. one file lesson held 34 rows for 22 users = 12
-- duplicates) because the old client inserted completions without checking
-- the existing state or the insert result.
--
-- 1) Collapse duplicates, keeping the EARLIEST completion per (user, lesson)
--    so the recorded completion timestamp is the real one.
-- 2) Add a UNIQUE(user_id, lesson_id) constraint so duplicates can never
--    come back (and so client upserts can rely on ON CONFLICT).
--
-- Both steps are idempotent and safe to re-run.

DELETE FROM public.lesson_completions lc
WHERE lc.id NOT IN (
  SELECT DISTINCT ON (user_id, lesson_id) id
  FROM public.lesson_completions
  ORDER BY user_id, lesson_id, completed_at ASC, id ASC
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lesson_completions_user_lesson_unique'
  ) THEN
    ALTER TABLE public.lesson_completions
      ADD CONSTRAINT lesson_completions_user_lesson_unique
      UNIQUE (user_id, lesson_id);
  END IF;
END $$;
