-- Admin-driven "reset personality assessment" — soft-delete via voided_at/voided_by
-- so the row stays in history for audit but is excluded from "latest" lookups and
-- from the 7-day cooldown check. Admin sets voided_at; the student can then retake
-- immediately without losing the prior answer record.
--
-- Idempotent: safe to re-run.

-- 1. Add columns
alter table public.personality_assessments
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id) on delete set null;

create index if not exists idx_personality_assessments_active_lookup
  on public.personality_assessments (user_id, tenant_id, created_at desc)
  where voided_at is null;

-- 2. Update cooldown trigger to ignore voided rows
create or replace function public.enforce_personality_cooldown()
returns trigger as $$
begin
  if exists (
    select 1 from public.personality_assessments
    where user_id = new.user_id
      and tenant_id = new.tenant_id
      and created_at > now() - interval '7 days'
      and voided_at is null
  ) then
    raise exception 'personality_cooldown_active' using errcode = 'P0001';
  end if;
  return new;
end;
$$ language plpgsql;

-- The trigger itself was defined in 20260507120000_create_personality_assessments.sql
-- and re-uses this function name, so no re-binding needed. Verify with:
--   select tgname from pg_trigger where tgrelid = 'public.personality_assessments'::regclass;
