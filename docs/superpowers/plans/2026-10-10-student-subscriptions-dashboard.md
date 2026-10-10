# Student Subscriptions Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** KPI dashboard (paying students, MRR, average lifetime, revenue chart) and a per-student subscription cell on `/admin/users`, fed by an hourly sync of the "תלמידים" Google Sheet tab.

**Architecture:** Edge function reads the sheet with a service account, parses / matches / estimates via a pure `_shared` module, and atomically replaces `student_subscriptions` through a service-role-only RPC. The page reads that admin-only table; all KPI math is a pure `src/lib` module.

**Tech Stack:** Supabase (Postgres, RLS, pg_cron + pg_net, Deno edge functions), React + TS, shadcn/ui, recharts, vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-student-subscriptions-dashboard-design.md`

## Global Constraints

- Revenue data is admin-only: RLS `has_role(auth.uid(),'admin') OR is_super_admin(auth.uid())`; UI renders only when `isAdmin`.
- The sync response contains counts only — never names, emails, or phones.
- A failed parse or Google error must never replace the table.
- Activity pings at or before `2026-08-23T10:14:23.422Z` are backfill fabrications and are not activity.
- Phone ambiguity is terminal (unmatched + `ambiguous_phone`), never a tie-break.
- All UI strings go through `t()` with he/en/es entries in `LanguageContext.tsx`.
- Acceptance anchor on today's sheet: 43 paying, MRR ₪10,420, 26 active without price.

## Review Focus

1. Header row renamed or moved → sync logs an error and keeps the previous data (test in Task 1: `parseSheet` throws `HeaderNotFound`).
2. The same student twice in the sheet (re-subscribed) → `byUserId` prefers the active row, then the latest start (test in Task 4).
3. Prices like `₪1,220.00`, `244`, `₪ 208`, and `0` → 1220 / 244 / 208 / 0 (test in Task 1).
4. ISO dates (`2026-07-13`) and junk (`pay box חודש`) in date columns → parsed / null, no throw (test in Task 1).
5. Empty table or zero churn → zeros and "no churn yet", no NaN / Infinity (test in Task 4).

---

### Task 1: Sheet parsing, matching, and date estimation (`_shared`)

**Files:**
- Create: `supabase/functions/_shared/subscription-sheet.ts`
- Test: `supabase/functions/_shared/subscription-sheet.test.ts` (vitest, like `phone-match.test.ts`)

**Interfaces:**
- Produces:
  - `type SubStatus = 'active' | 'cancelled' | 'payment_failed' | 'unknown'`
  - `interface SheetRow { sheetRow: number; fullName: string|null; email: string|null; phone: string|null; status: SubStatus; statusRaw: string|null; monthlyPrice: number|null; startedAt: string|null /* YYYY-MM-DD */; cancelledAt: string|null }`
  - `class HeaderNotFoundError extends Error`
  - `parseSheet(values: string[][]): SheetRow[]`
  - `parsePrice(raw): number|null`, `parseSheetDate(raw): string|null`, `mapStatus(raw): SubStatus`
  - `interface ProfileLite { id: string; email: string|null; phone: string|null; join_date: string|null; deletedAt: string|null }`
  - `matchRow(row, profiles): { userId: string|null; method: 'email'|'phone'|null; note: string|null }`
  - `interface ActivitySignals { revokedAt?: string|null; activityPingAt?: string|null; lastLessonAt?: string|null; lastAuthEventAt?: string|null; lastSignInAt?: string|null; joinDate?: string|null }`
  - `ACTIVITY_TRACKING_SINCE = '2026-08-23T10:14:23.422Z'`
  - `estimateDates(row, signals): { startedAt, startedAtSource: 'sheet'|'platform_signup'|null, cancelledAt, cancelledAtSource: 'sheet'|'access_revoked'|'last_activity'|null }`

Tests: header below a data row (row 1 is a student) · header not found throws · price formats · date formats incl. ISO, junk, and impossible dates (`31-02-2026`) · status mapping · email match case-insensitive and ignoring deleted profiles · phone fallback · ambiguous phone · deleted-only phone · estimate ladder: sheet wins; join_date fallback; revoked_at before activity; ping at the backfill instant ignored; cancel earlier than start discarded; active rows never get a cancel estimate.

### Task 2: Migration (tables, RLS, RPC, cron)

**Files:**
- Create: `supabase/migrations/20261010120000_student_subscriptions.sql`

Contents: `student_subscriptions` + `subscription_sync_runs` per spec; RLS enabled with an admin-only SELECT policy on each; `replace_student_subscriptions(rows jsonb)` SECURITY DEFINER with `search_path = public`, DELETE + INSERT from `jsonb_to_recordset`, EXECUTE revoked from public/anon/authenticated and granted to service_role; hourly cron `invoke-sync-subscriptions-sheet` (idempotent DO block, pg_net POST `{"trigger":"cron"}`).

Verify: `supabase db lint`-free SQL by reading; applied at deploy time (Task 6).

### Task 3: Edge function `sync-subscriptions-sheet`

**Files:**
- Create: `supabase/functions/_shared/google-auth.ts` (service-account JWT → access token via WebCrypto)
- Create: `supabase/functions/sync-subscriptions-sheet/index.ts`
- Modify: `supabase/config.toml` (add `[functions.sync-subscriptions-sheet] verify_jwt = false`)

**Interfaces:**
- Consumes: everything from Task 1; the RPC and tables from Task 2.
- Produces: POST `{ trigger?: 'cron'|'manual' }` → `{ ok, skipped?, rows_total, rows_matched, error? }`.

Flow: 60 s throttle on the last ok run → log run start → fetch token + values → `parseSheet` → load profiles (paged) → `matchRow` → collect signals for matched rows (access_limits, student_activity, lesson_completions, user_activities ≠ password_reset, auth last_sign_in_at for cancelled-without-date rows) → `estimateDates` → RPC replace → finish run. Missing secrets → run `error='not_configured'`.

Verify: `deno check supabase/functions/sync-subscriptions-sheet/index.ts`.

### Task 4: KPI math (`src/lib`)

**Files:**
- Create: `src/lib/subscriptionMetrics.ts`
- Test: `src/lib/subscriptionMetrics.test.ts`

**Interfaces:**
- Produces:
  - `interface SubscriptionRow { id; sheet_row; full_name; email; phone; status: SubStatus; status_raw; monthly_price: number|null; started_at: string|null; started_at_source; cancelled_at: string|null; cancelled_at_source; user_id: string|null; match_method; match_note; synced_at }`
  - `isPaying(row): boolean`
  - `computeKpis(rows, today: Date): { payingCount; mrr; activeWithoutPrice; paymentFailedCount; cancelledCount; monthlyChurn: number|null; expectedLifetimeMonths: number|null; avgCancelledLifetimeMonths: number|null }`
  - `revenueSeries(rows, today: Date, opts?: { back?: number; forward?: number }): Array<{ month: string /* YYYY-MM */; actual: number|null; forecast: number|null }>`
  - `pickPerUser(rows): Map<string, SubscriptionRow>`

Tests: anchor-shaped fixture (41×244 + 2×208 active, 26 active without price) → 43 / 10420 / 26 · churn over last 3 complete months only · undated cancelled excluded from churn · zero churn → `expectedLifetimeMonths = null` · avg cancelled lifetime · revenue history with unknown start · forecast recurrence and the current month carrying both actual and forecast (to join the lines) · `pickPerUser` prefers active then latest start.

### Task 5: Dashboard UI and table column

**Files:**
- Create: `src/hooks/useStudentSubscriptions.ts`
- Create: `src/components/admin/SubscriptionsDashboard.tsx`
- Create: `src/components/admin/SubscriptionCell.tsx`
- Modify: `src/pages/admin/ManageUsers.tsx` (render dashboard between header and filters when `isAdmin`; new column in desktop table; line in mobile card)
- Modify: `src/contexts/LanguageContext.tsx` (`manageUsers.subs.*`)

Verify: `npx tsc -p tsconfig.app.json --noEmit`, `npm run lint` (changed files), `npm test`, `npm run build`; visual check in the browser.

### Task 6: Deploy and live check (needs Yaniv's go-ahead)

- Service-account setup guide → secrets → `supabase db push` → `supabase functions deploy sync-subscriptions-sheet` → manual sync → confirm the anchor on the live dashboard.
