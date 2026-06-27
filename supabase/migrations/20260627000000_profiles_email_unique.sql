-- Defense-in-depth against the account-hijack class of bug (see the
-- admin-user-actions / external-api fixes): no two ACTIVE profiles may share
-- an email (case-insensitive). If a buggy code path ever tries to upsert one
-- user's email onto another profile, the DB now rejects it loudly instead of
-- silently corrupting the account + mis-assigning role/enrollments.
--
-- Partial index: excludes soft-deleted rows (deleted_at) and null emails so a
-- legitimate re-signup after deletion still works.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_lower_unique
  ON public.profiles (lower(email))
  WHERE email IS NOT NULL AND deleted_at IS NULL;
