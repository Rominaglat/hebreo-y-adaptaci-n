-- Add scoring_version to personality_assessments so the report renderer can
-- branch between the legacy share-only model (v1) and the v3 centered-strength
-- model that adds independent per-axis strengths + dominance label.
--
-- v1 = pre-2026-05-13 rows: emyth_scores/disc_scores have only shares
-- v3 = new rows: emyth_scores has { entrepreneur, manager, artisan, strengths, dominance_label }
--                disc_scores  has { R, Y, G, B, strengths }
--
-- Idempotent: safe to re-run.

alter table public.personality_assessments
  add column if not exists scoring_version text;

-- Backfill: every row that pre-dates this migration is v1. NEW rows write 'v3'
-- explicitly from the edge function. Restricted to rows that don't already
-- have a value so the migration is fully idempotent.
update public.personality_assessments
   set scoring_version = 'v1'
 where scoring_version is null;

alter table public.personality_assessments
  alter column scoring_version set default 'v3';

alter table public.personality_assessments
  alter column scoring_version set not null;
