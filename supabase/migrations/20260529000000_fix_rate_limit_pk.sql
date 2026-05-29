-- rate_limit_buckets was created in base_schema with a composite PK
-- (key, window_start) instead of the simple PK (key) the security_phase_2
-- migration assumes. The RPC `check_and_increment_rate_limit` does
-- `ON CONFLICT (key)` which fails with 42P10. Migrate the constraint.

DO $$
DECLARE
  pk_name TEXT;
BEGIN
  SELECT conname INTO pk_name
  FROM pg_constraint
  WHERE conrelid = 'public.rate_limit_buckets'::regclass
    AND contype = 'p';
  IF pk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.rate_limit_buckets DROP CONSTRAINT %I', pk_name);
  END IF;
END $$;

-- The composite PK was already unique on (key, window_start). The lock-step
-- ensures we never have two rows with the same key alive at once: drop dupes
-- (keep the most recent window) before reasserting the new PK.
DELETE FROM public.rate_limit_buckets b
WHERE EXISTS (
  SELECT 1 FROM public.rate_limit_buckets b2
  WHERE b2.key = b.key AND b2.window_start > b.window_start
);

ALTER TABLE public.rate_limit_buckets
  ADD CONSTRAINT rate_limit_buckets_pkey PRIMARY KEY (key);
