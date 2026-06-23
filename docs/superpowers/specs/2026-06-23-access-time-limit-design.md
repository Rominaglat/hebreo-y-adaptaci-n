# Access Time Limit — Design Spec

**Date:** 2026-06-23
**Status:** Approved (design), pending implementation plan

## Summary

Add an optional **time-limited access** capability to the learning portal. A user
can be granted access that automatically expires after a given duration. When the
limit is reached, the user's access to **all content is removed** and their role is
**downgraded to `lead`**.

Two ways to set the limit:

1. **API** — a new optional `access_hours` field on the `users.create` action of the
   `external-api` edge function.
2. **Manual (admin UI)** — a new "Time limit" action in the per-user three-dots menu
   on the Manage Users page, opening a dialog to choose **either** an exact date+time
   **or** a number of hours.

## Approved product decisions

1. **"Remove access to all content" = delete the user's `enrollments` rows + force role to `lead`.**
   This is destructive: per-course progress on those enrollments is lost and is only
   restored by re-enrolling. Accepted, consistent with how the app already gates
   content (content visibility is driven entirely by `enrollments`).
2. **Applies on next refresh/navigation.** Server-side state (enrollments + role)
   changes immediately at sweep time; a live browser tab reflects it on its next data
   fetch / token refresh. No forced immediate logout.
3. **Students & leads only.** Setting a limit is blocked for `admin`, `super_admin`,
   and `instructor` targets, enforced at both write paths and defensively in the sweep.
4. **`access_hours` semantics:** absent or `0` → unlimited (no limit row). `> 0` →
   expires `access_hours` hours after the row is written.

## Background (current architecture)

- **Roles:** `public.user_roles(user_id, role)` with enum `app_role`
  (`super_admin > admin > instructor > student > lead`). `lead` already exists
  (migration `20260603130000_add_lead_role.sql`). Frontend `AuthContext`
  (`src/contexts/AuthContext.tsx`) selects the highest role and exposes `isLead`,
  which drives all UI restrictions (route guard to `/courses` only, locked nav, no
  bot/dashboard).
- **Content access = enrollments:** `public.enrollments(user_id, course_id, ...)`.
  `src/pages/Courses.tsx` lists only enrolled courses; `src/pages/CourseDetail.tsx`
  gates a course on an enrollment row. Deleting enrollments removes content access.
- **`lead` semantics:** read-only access to courses they are *explicitly enrolled in*,
  nothing else. So after a downgrade we must also remove enrollments — otherwise the
  lead would still see those courses.
- **Scheduling:** `pg_cron` is enabled (the `cleanup-empty-rooms` job runs every 5 min,
  scheduled in `20260515130000_study_rooms_hardening_v2.sql`). Established pattern.
- **No prior expiry/trial concept exists.** Built from scratch.
- **Edge functions** run with the service-role key (bypass RLS). `external-api` is
  authenticated by an API key (`X-API-Key`); `admin-user-actions` is authenticated by
  a user JWT and checks the caller's role.

## Component 1 — Data model (new migration)

New migration `supabase/migrations/20260623120000_access_time_limit.sql`.

### Table `public.access_limits`

```sql
CREATE TABLE IF NOT EXISTS public.access_limits (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,                 -- NULL = pending; set when the sweep has processed it
  created_by UUID,                        -- admin who set it; NULL when set via API
  source     TEXT NOT NULL DEFAULT 'admin', -- 'api' | 'admin'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS access_limits_pending_idx
  ON public.access_limits (expires_at)
  WHERE revoked_at IS NULL;
```

- One active limit per user (PK on `user_id`). Setting a new limit **upserts** and
  resets `revoked_at` to `NULL` (re-arms).
- Partial index supports the sweep's `expires_at <= now() AND revoked_at IS NULL` scan.

### RLS

```sql
ALTER TABLE public.access_limits ENABLE ROW LEVEL SECURITY;

-- Admins/instructors may read (to display current limit + badge in Manage Users).
CREATE POLICY "Admins and instructors can read access_limits"
  ON public.access_limits FOR SELECT
  USING (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()));
```

No client INSERT/UPDATE/DELETE policy — all writes go through service-role edge
functions.

### Sweep function `public.revoke_expired_access()`

`SECURITY DEFINER`, `search_path = public`. Returns the number of users processed.

```sql
CREATE OR REPLACE FUNCTION public.revoke_expired_access()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  processed integer := 0;
BEGIN
  FOR r IN
    SELECT al.user_id
    FROM public.access_limits al
    WHERE al.expires_at <= now()
      AND al.revoked_at IS NULL
  LOOP
    -- Defensive guard (decision #3): never downgrade a privileged account,
    -- even if a limit row somehow exists for one.
    IF EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = r.user_id
        AND ur.role IN ('admin', 'super_admin', 'instructor')
    ) THEN
      UPDATE public.access_limits SET revoked_at = now(), updated_at = now()
        WHERE user_id = r.user_id;   -- mark handled so we stop scanning it
      CONTINUE;
    END IF;

    -- 1. Remove access to all content.
    DELETE FROM public.enrollments WHERE user_id = r.user_id;

    -- 2. Downgrade to lead (replace all role rows with a single 'lead').
    DELETE FROM public.user_roles WHERE user_id = r.user_id;
    INSERT INTO public.user_roles (user_id, role)
      VALUES (r.user_id, 'lead')
      ON CONFLICT DO NOTHING;

    -- 3. Mark processed.
    UPDATE public.access_limits SET revoked_at = now(), updated_at = now()
      WHERE user_id = r.user_id;

    processed := processed + 1;
  END LOOP;

  RETURN processed;
END;
$$;
```

> `user_roles` has no unique constraint on `(user_id, role)` in the base schema, so the
> `ON CONFLICT DO NOTHING` is a safety belt; correctness comes from the preceding
> `DELETE`. The implementation plan should confirm whether a unique index exists and
> adjust if needed.

### Cron schedule

Mirror the `cleanup-empty-rooms` guard pattern — pure SQL, **no `pg_net`/HTTP** needed
since the logic is a DB function:

```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM 1 FROM cron.job WHERE jobname = 'invoke-revoke-expired-access';
    IF NOT FOUND THEN
      PERFORM cron.schedule(
        'invoke-revoke-expired-access',
        '*/10 * * * *',
        $cron$SELECT public.revoke_expired_access();$cron$
      );
    END IF;
  ELSE
    RAISE NOTICE 'pg_cron not enabled — skipping revoke-expired-access schedule.';
  END IF;
END$$;
```

Sweep granularity: every 10 minutes → worst-case ~10 min beyond the exact expiry.
Negligible for hour-scale limits; tunable.

## Component 2 — API write path (`external-api` → `users.create`)

File: `supabase/functions/external-api/index.ts`, `case 'users.create'` (~lines 290-404).

After the user, profile, role, and enrollments are created, add:

- Read optional `data.access_hours`. Coerce to a number.
- Validate: must be a finite number `>= 0`. On invalid (negative / NaN) → existing
  `VALIDATION_ERROR` response.
- If `access_hours > 0` **and** `resolvedRole` ∈ {`student`, `lead`}:
  - `expires_at = now() + access_hours hours` (compute in JS:
    `new Date(Date.now() + access_hours * 3600_000).toISOString()`).
  - `upsert` into `access_limits` (`user_id`, `expires_at`, `source: 'api'`,
    `created_by: null`, `revoked_at: null`).
- If `access_hours > 0` but role is privileged → skip silently, include a note in the
  response (do not fail the create).
- Include `access_expires_at` (or `null`) in the returned `user` object.

No new action — only an additive optional field on `users.create`. Backward compatible.

## Component 3 — Manual write path (`admin-user-actions`)

File: `supabase/functions/admin-user-actions/index.ts`.

- Extend the `AdminActionRequest` action union with `"set_access_limit"`, and add
  optional fields: `expiresAt?: string` (ISO), `hours?: number`, `clear?: boolean`.
- **Admin-only.** Do NOT add it to `INSTRUCTOR_ALLOWED_ACTIONS`; non-admins are already
  rejected for unknown actions.
- New `case "set_access_limit"`:
  1. Require `targetUserId`.
  2. Fetch target's roles. If target holds `admin` / `super_admin` / `instructor` →
     `403` with message key (decision #3).
  3. If `clear === true` → `DELETE FROM access_limits WHERE user_id = targetUserId`,
     return success.
  4. Else compute `expires_at`:
     - `expiresAt` provided → parse ISO; must be a valid date in the future.
     - else `hours` provided → must be a finite number `> 0`; `expires_at = now() + hours`.
     - neither/invalid → `400`.
  5. `upsert` into `access_limits` (`user_id`, `expires_at`, `source: 'admin'`,
     `created_by: adminUserId`, `revoked_at: null`, `updated_at: now()`).
  6. `writeAuditLog("set_access_limit", targetUserId, null, before, { expires_at })`.
  7. Return `{ success: true, expiresAt }`.

## Component 4 — Manage Users UI

File: `src/pages/admin/ManageUsers.tsx`.

### Data
- `fetchUsers()` additionally reads `access_limits` (`user_id, expires_at, revoked_at`)
  and maps it onto each user row (for prefill + badge). RLS already allows admin read.

### Menu item (both desktop table + mobile cards)
- New `DropdownMenuItem` with a `Clock` icon (lucide), label `t('manageUsers.setTimeLimit')`,
  placed near the other edit actions.
- Shown only when `canEdit` **and** the target user's role ∈ {`student`, `lead`}.

### Dialog (mirror the reset-password dialog pattern)
- Mode toggle: **Hours** vs **Exact date & time**.
- Hours mode: `<Input type="number" min="1">`, default `24`.
- Date mode: `<input type="datetime-local">`; convert local → ISO via
  `new Date(value).toISOString()`.
- If the user already has an active limit (`expires_at` in the future, `revoked_at`
  null): show "Expires at <formatted date>" and a **Remove limit** button (sends
  `{ clear: true }`).
- Submit → `supabase.functions.invoke('admin-user-actions', { body: { action: 'set_access_limit', userId, hours | expiresAt }, headers: { Authorization: Bearer <session token> } })`.
- On success → success toast, close dialog, `fetchUsers()`. On error → destructive toast.

### Row badge (nice-to-have)
- Small "⏳ until <date>" indicator on rows with an active, unexpired limit. Include if
  cheap; not required for v1.

### i18n
Add keys to the `translations` map in `src/contexts/LanguageContext.tsx` (each with
`he` / `en` / `es`), e.g.:
- `manageUsers.setTimeLimit` — "מגבלת זמן" / "Time limit" / "Límite de tiempo"
- `manageUsers.timeLimit.title`, `.description`
- `manageUsers.timeLimit.modeHours`, `.modeDate`
- `manageUsers.timeLimit.hoursLabel`, `.dateLabel`
- `manageUsers.timeLimit.currentlyExpires` ("פג ב-{date}")
- `manageUsers.timeLimit.remove` ("הסר מגבלה")
- `manageUsers.timeLimit.set` ("הגדרת מגבלה")
- `manageUsers.timeLimit.toast.setTitle`, `.setDesc`, `.removedTitle`
- `manageUsers.timeLimit.error.privilegedTarget` ("אפשר להגדיר מגבלת זמן רק לסטודנטים ולידים")

## Edge cases & notes

- **Timezone:** `expires_at` stored as `timestamptz` (UTC). `datetime-local` is local;
  convert with `toISOString()` on the client.
- **Re-arming:** setting a new limit on a user whose limit already fired resets
  `revoked_at` to null; the sweep will process it again at the new time.
- **Restoring access:** an admin re-enrolling and/or re-promoting a downgraded user is
  the manual recovery path. The `access_limits` row can be cleared via the dialog.
- **Already-expired input:** an `expiresAt` in the past → reject in `admin-user-actions`
  (`400`). For the API, `access_hours > 0` is always future.
- **Multiple roles:** the sweep deletes all `user_roles` rows and inserts exactly `lead`.

## Testing

- **DB function:** insert an `access_limits` row with `expires_at = now() - 1 minute`
  for a seeded student who has enrollments + a `student` role; run
  `SELECT public.revoke_expired_access();`; assert enrollments deleted, single `lead`
  role, `revoked_at` set, return value `1`. Repeat for a privileged target → asserted
  untouched (only `revoked_at` stamped), return value excludes it.
- **`external-api` users.create:** create with `access_hours: 24` → `access_limits` row
  with `expires_at ≈ now()+24h`; with `access_hours: 0`/absent → no row; with a
  privileged role + hours → no row.
- **`admin-user-actions` set_access_limit:** hours path, exact-date path, clear path,
  privileged-target rejection, past-date rejection.
- **Frontend:** menu item visibility by role; dialog set (hours + date) → toast +
  refetch; remove-limit; (vitest where feasible, otherwise manual per existing
  conventions — the component uses `useState` + manual `fetchUsers`, not react-query).

## Files touched

- `supabase/migrations/20260623120000_access_time_limit.sql` (new)
- `supabase/functions/external-api/index.ts`
- `supabase/functions/admin-user-actions/index.ts`
- `src/pages/admin/ManageUsers.tsx`
- `src/contexts/LanguageContext.tsx`
