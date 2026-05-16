# Single-tenant deployment runbook

This codebase is a single-tenant LMS. Every new customer deployment is its
own Supabase project + its own Vercel hosting. There is no shared
infrastructure between customers.

## What "single tenant" means in code

The frontend still references a `tenant_id` on most rows (Phase 1 of the
multi-tenancy removal — kept for safe rollback). All queries pin to a
single tenant id resolved at runtime by `TenantContext`. That id is
declared in [`src/constants/singleTenant.ts`](../../src/constants/singleTenant.ts).

When the DB schema migration (Phase 2) lands the column will go away and
this layer becomes a no-op.

## Deploying for a new customer

### 1. Provision a fresh Supabase project

In the Supabase dashboard:

1. Create a new project. Note the project ref, anon key, and service-role
   key.
2. Run the migrations from `supabase/migrations/` against the new project,
   either via `supabase db push` or by POSTing each `.sql` file to the
   Supabase Management API SQL endpoint.

### 2. Seed the single `tenants` row

The portal expects exactly one `tenants` row with a known id. Pick one of
the two options below:

**Option A — match the existing constant** (fastest):

```sql
INSERT INTO public.tenants (id, name, slug, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  '<Customer display name>',
  '<customer-slug>',
  true
);
```

`name` and `slug` can be anything — they're only used for branding labels.
The id MUST match the constant in `src/constants/singleTenant.ts`.

**Option B — pick a fresh id, override via env var** (no code changes):

```sql
INSERT INTO public.tenants (id, name, slug, is_active)
VALUES (gen_random_uuid(), '<name>', '<slug>', true)
RETURNING id;
```

Take the returned id and set `VITE_TENANT_ID` in the Vercel project to
that value. Optionally also set `VITE_TENANT_SLUG`. The code reads these
at build time so no fork or rebuild-from-fork is needed.

### 3. Seed memberships for initial admins

Every authenticated user must have a `tenant_memberships` row to pass the
RLS policies on the tenant-scoped tables. Easiest path: insert a row per
admin user after they sign up.

```sql
-- After admin@customer.com signs up via the portal:
INSERT INTO public.tenant_memberships (user_id, tenant_id, role, is_default)
VALUES (
  '<auth.users.id of the new admin>',
  '<SINGLE_TENANT_ID>',
  'admin',
  true
);
```

Subsequent users created via the in-app "Manage Users" flow get their
membership row written automatically by the `admin-user-actions` edge
function.

### 4. Set Supabase secrets

The edge functions read:

- `SUPABASE_SERVICE_ROLE_KEY` — auto-set by Supabase, no action needed.
- `RESEND_API_KEY` — get from resend.com.
- `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` — for AI features.
- `KG_API_TOKEN` — Knowledge Graph service auth token.
- `AUDIT_WEBHOOK_INTERNAL_SECRET` — random string for HMAC signing.

Set each via:

```bash
supabase secrets set KEY=value --project-ref <new-project-ref>
```

### 5. Deploy edge functions

Edge functions MUST deploy with `--no-verify-jwt` (the portal handles JWT
verification inside each function).

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy <name> \
  --no-verify-jwt --project-ref <new-project-ref>
```

### 6. Configure Vercel

Set these env vars in the Vercel project:

| Var | Required | Value |
|-----|----------|-------|
| `VITE_SUPABASE_URL` | Yes | `https://<new-project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Yes | The new project's anon key |
| `VITE_TENANT_ID` | If using Option B | The id from `INSERT INTO tenants … RETURNING id` |
| `VITE_TENANT_SLUG` | Optional | Slug for branding labels (defaults to `default`) |

A `.env.example` lives at the repo root with the same list.

### 7. First login + sanity check

1. Sign up the first admin user through the portal.
2. Insert their membership row (step 3 above).
3. Log in and confirm:
   - Sidebar shows the customer's logo + name (no dropdown switcher).
   - "ניהול ארגונים" / "Manage Tenants" is NOT in the nav.
   - Courses, study rooms, etc. are scoped to this customer only.

## Rollback to multi-tenant

If a customer ever needs to revert to multi-tenant mode (unlikely):

```bash
git reset --hard pre-single-tenant-v1
```

The DB schema was unchanged during Phase 1, so the revert is a pure code
revert. No data restore needed.

## Phase 2 (future)

When Phase 2 ships, this runbook will simplify: no `tenants` row to seed,
no `tenant_memberships` to populate. Watch for the commit
`feat(single-tenant): Phase 2 — drop tenant schema`.
