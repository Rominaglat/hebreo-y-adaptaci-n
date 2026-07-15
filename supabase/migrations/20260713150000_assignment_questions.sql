-- Assignment lessons now hold a structured list of questions (authored in the
-- lesson editor, NOT in the free-text description). Each student submission
-- stores one answer per question (free text + optional voice recording).

-- lessons.assignment_questions: jsonb array of { "id": text, "text": text }
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS assignment_questions jsonb;

-- assignment_submissions.answers: jsonb array of
--   { "questionId": text, "text": text, "audioPath": text|null }
-- (the legacy answer_text / audio_path columns stay for compatibility but are
--  no longer written by the app.)
ALTER TABLE public.assignment_submissions
  ADD COLUMN IF NOT EXISTS answers jsonb NOT NULL DEFAULT '[]'::jsonb;
