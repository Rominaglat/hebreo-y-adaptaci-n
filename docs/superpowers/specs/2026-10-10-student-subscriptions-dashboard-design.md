# Student Subscriptions Dashboard — Design Spec

**Date:** 2026-10-10
**Status:** Implemented

> **Revision (same day):** nobody on the team could create a service account on
> the Google account that owns the sheet, so the sheet is read through an
> **Apps Script "bridge"** instead (`scripts/sheet-bridge/Code.gs`): a web app
> under any Google account that can *open* the sheet, answering only to a shared
> token. Wherever this spec says "service account", read "bridge". Error code
> `google_error` became `bridge_error`; secrets are `SHEET_BRIDGE_URL` and
> `SHEET_BRIDGE_TOKEN`.

## Summary

Add a KPI dashboard above the students table on the Manage Users page
(`/admin/users`, `src/pages/admin/ManageUsers.tsx`) showing:

1. **Paying students** — how many students pay right now.
2. **Expected monthly revenue** (MRR) — sum of the current paying students' monthly price.
3. **Average student lifetime** — how many months a student stays subscribed.
4. **Revenue chart** — monthly revenue for the past 6 months plus a 6-month forecast.

Each student row in the table also gets a **subscription** cell: monthly price + status.

The portal has **no subscription data today** (no price / status / cancellation
table). The source of truth is the Google Sheet **"מעקב לקוחות מאסטר"**, tab
**"תלמידים"** (`1D3gblg5NqEUVa53bFPQ8A9qDlGXw3VaCQJrK0PwTgQY`, gid `1178858441`).
The portal keeps a synced copy of that tab in the database and fills date gaps
with estimates from platform data.

## Approved product decisions

1. **The sheet stays the place Romina edits.** The portal holds a one-way synced copy
   (sheet → DB). There is no in-portal editing; corrections are made in the sheet and
   arrive on the next sync. (In-portal editing was offered and declined for v1.)
2. **Sync via an Apps Script bridge** (see revision note), read-only on the sheet.
   Runs hourly (pg_cron) and on demand from a "Sync now" button.
3. **Missing dates are estimated from platform data**, marked as estimated in the UI:
   - missing join date → the profile's `join_date` (platform signup);
   - cancelled with no cancel date → `access_limits.revoked_at`, else the student's
     last real activity in the platform.
4. **Revenue figures are admin-only.** Instructors (who can view Manage Users read-only)
   do not see the dashboard or the subscription column; RLS enforces it.

## The sheet today (measured 2026-10-10)

Tab "תלמידים", 95 student rows:

| Column header | Content | Fill rate |
|---|---|---|
| *(none — col A)* | full name | — |
| `טלפון` | free-text phone, mostly IL national (`055-249-1243`) | — |
| `מייל` | email | — |
| `סטטוס` | `פעיל` 69 · `בוטל` 25 · `תשלום לא עבר` 1 | 95/95 |
| `הערות` | free text (`פתוח`, `בוטל חודש 10`, `2`…) | 24/95 |
| `תאריך הצטרפות` | `DD-MM-YYYY` | 52/95 |
| `תאריך ביטול` | meant to be a date; today 1 cell, not a date (`pay box חודש`) | 0/95 real |
| `שווי חיי לקוח` | **the monthly price**: `₪244.00` ×48, `₪208.00` ×2 (one written `244`) | 50/95 |
| *(none)* | payment method (`פולר`, `העברה חד פעמית`) | 4/95 |

Quirks the parser must survive:

- **The header is row 2, and row 1 is a real student** sitting above it. Rows are
  data if they have an email or a phone, wherever they are; the header row is found
  by its cell texts, not by position.
- Price strings carry `₪`, thousands separators and decimals, or are bare numbers.
- Junk in a date column (`pay box חודש`) must parse to "no date", not fail the sync.
- 26 active rows have no price. They are **not** counted as paying, and the dashboard
  says so (see KPIs).

Acceptance anchor: with today's sheet the dashboard must show **43 paying** students
and **MRR ₪10,420** (41 × ₪244 + 2 × ₪208), with **26 active without a price**.

## Architecture

```
Google Sheet ──(service account, read-only)──▶ edge fn sync-subscriptions-sheet
                                                 │ parse → match → estimate
                                                 ▼
                                RPC replace_student_subscriptions (atomic)
                                                 ▼
                          public.student_subscriptions  (admin-only RLS)
                          public.subscription_sync_runs (admin-only RLS)
                                                 ▼
          ManageUsers ─ useStudentSubscriptions() ─▶ SubscriptionsDashboard + table cell
                                (pure math: src/lib/subscriptionMetrics.ts)
```

### Database (one migration)

**`public.student_subscriptions`** — one row per student row in the sheet.
Full replace on every sync (the sheet is authoritative and rows have no stable id).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `sheet_row` | int not null | 1-based row in the sheet, for traceability |
| `full_name`, `email`, `phone` | text | as written in the sheet |
| `status` | text not null | `active` \| `cancelled` \| `payment_failed` \| `unknown` |
| `status_raw` | text | original cell text |
| `monthly_price` | numeric(10,2) | null = no price in sheet |
| `started_at` | date | |
| `started_at_source` | text | `sheet` \| `platform_signup` \| null |
| `cancelled_at` | date | |
| `cancelled_at_source` | text | `sheet` \| `access_revoked` \| `last_activity` \| null |
| `user_id` | uuid → `profiles(id)` ON DELETE SET NULL | null = not matched |
| `match_method` | text | `email` \| `phone` \| null |
| `match_note` | text | e.g. `ambiguous_phone`, `deleted_account` |
| `synced_at` | timestamptz not null | |

Index on `user_id`.

**`public.subscription_sync_runs`** — append-only log: `id`, `started_at`,
`finished_at`, `ok` bool, `trigger` (`cron` \| `manual`), `rows_total`,
`rows_matched`, `error` text. The dashboard reads the latest row.

**`public.replace_student_subscriptions(_rows jsonb)`** — SECURITY INVOKER (service_role bypasses RLS; a leaked grant would still hit deny-all RLS),
`DELETE` + `INSERT` in one transaction so a reader never sees a half-synced table.
`EXECUTE` revoked from `public`, `anon`, `authenticated`; service role only.

**RLS** on both tables: enabled; a single `SELECT` policy
`has_role(auth.uid(), 'admin') OR is_super_admin(auth.uid())`. No write policies
(writes go through the service role only).

**Cron:** `invoke-sync-subscriptions-sheet`, hourly (`0 * * * *`), pg_net POST with
body `{"trigger":"cron"}`, same idempotent pattern as
`20260823110000_lifecycle_emails_enable_cron.sql`.

### Edge function `sync-subscriptions-sheet`

- `verify_jwt = false` (cron calls it unauthenticated, like the other sweeps). The
  only accepted body field is `trigger`. The response carries **counts only**, never
  PII. A run is skipped if a successful run finished less than 60 s ago, so an
  abusive caller can at worst cause one extra read per minute.
- **Google auth:** secret `GOOGLE_SERVICE_ACCOUNT_JSON`. Signs an RS256 JWT with
  WebCrypto (no new dependency), exchanges it at `oauth2.googleapis.com/token` for a
  token with scope `spreadsheets.readonly`.
- **Read:** `GET sheets/v4/spreadsheets/{SUBSCRIPTIONS_SHEET_ID}/values/{tab}!A1:Z2000`
  with `FORMATTED_VALUE`. Tab name from `SUBSCRIPTIONS_SHEET_TAB` (default `תלמידים`).
- **Pure logic in `supabase/functions/_shared/subscription-sheet.ts`** (Deno tests,
  same style as `phone-match.test.ts`):
  - `parseSheet(values)` → rows. Header row = the first row in the top 10 that
    contains both `טלפון` and `מייל`; columns located by header text (price column
    accepts `שווי חיי לקוח` / `מחיר` / `שווי מנוי`); the name column is A. Status map:
    `פעיל`→active, `בוטל`→cancelled, `תשלום לא עבר`→payment_failed, else unknown.
    Dates accept `DD-MM-YYYY`, `DD/MM/YYYY`, `D.M.YYYY` and must be real calendar
    dates. If no header row is found the sync **fails loudly** (logged run with
    error) instead of wiping the table.
  - `matchRow(row, profiles)` — email (trimmed, case-insensitive) against live
    profiles first; then `matchPhone` from `_shared/phone-match.ts`. `matched` → the
    profile; `ambiguous` → unmatched with note `ambiguous_phone` (never a tie-break,
    same rule as `users.inactivityByPhone`); `matched_deleted` → unmatched with note
    `deleted_account`.
  - `estimateDates(row, signals)` — fills `started_at` from `join_date`; for a
    cancelled row with no cancel date, `revoked_at`, else the latest real activity.
    "Real activity" = the same signals `users.inactivityByPhone` uses: lesson
    completions, `user_activities` excluding `password_reset`, auth `last_sign_in_at`,
    and a `student_activity` ping **only if strictly after
    `2026-08-23T10:14:23.422Z`** (earlier pings are backfill fabrications). An
    estimated cancel date earlier than `started_at` is discarded.

### Frontend

- **`src/lib/subscriptionMetrics.ts`** — pure functions + vitest:
  - `isPaying(row)`: `status === 'active' && monthly_price > 0`.
  - `computeKpis(rows, today)`: `payingCount`, `mrr`, `activeWithoutPrice`,
    `paymentFailedCount`, `monthlyChurn`, `expectedLifetimeMonths`,
    `avgCancelledLifetimeMonths`.
  - **Churn** over the last 3 *complete* calendar months: Σ(rows cancelled in month m)
    ÷ Σ(rows active at the start of m). Rows with no start date are treated as
    active since before the window. Cancelled rows with no cancel date (even after
    estimation) are left out of churn entirely — in neither numerator nor
    denominator — since we cannot place them in time.
  - **Average lifetime** (headline) = `1 / monthlyChurn`, shown as months with one
    decimal; when churn is 0 it shows "אין עדיין נטישה". The secondary line shows
    the plain average tenure of cancelled students that have both dates. The headline
    uses churn because the business started in June 2026, so cancelled-only tenure is
    capped at ~4 months and would read misleadingly short.
  - `revenueSeries(rows, today)`: for each of the past 6 months and the current month,
    the sum of prices of rows active at any point in that month (start ≤ month end and
    no cancel date before month start). Rows with an unknown start count from before
    the window; cancelled rows with no cancel date at all (even after estimation) are
    left out of history. **Forecast** for the next 6 months:
    `mrr(n) = mrr(n−1) × (1 − churn) + avgNewMrr`, starting from the current MRR, where
    `avgNewMrr` = average monthly price sum of rows that started in each of the last 3
    complete months.
- **`src/hooks/useStudentSubscriptions.ts`** — loads `student_subscriptions` and the
  latest `subscription_sync_runs` row (admin only; disabled for instructors), exposes
  `rows`, `byUserId`, `lastRun`, `sync()` (invokes the edge function with
  `trigger: 'manual'`, then refetches), `loading`, `error`.
- **`src/components/admin/SubscriptionsDashboard.tsx`**, placed in `ManageUsers`
  between the page header and the filters, rendered only when `isAdmin`:
  - Status bar: "סונכרן לפני X" (or the last error / "not configured yet"),
    **Sync now** button, and "N rows unmatched" link → dialog listing unmatched sheet
    rows (name, email, phone, note).
  - 4 stat cards (paying · MRR · average lifetime · payment failed), with secondary
    lines: "26 active without a price — not counted", "actual avg of cancelled: X".
  - Chart: recharts via `src/components/ui/chart.tsx`; solid line for history,
    dashed for forecast, ILS tooltips, RTL-aware.
- **Table:** new "Subscription" column in the desktop table and a line in the mobile
  card: `₪244/חודש` + status badge, `—` when the student has no sheet row. A tooltip
  shows start / cancel dates and marks estimated ones with their source.
- **Translations:** new `manageUsers.subs.*` keys in `LanguageContext.tsx` (he/en/es).

## Error handling

- Missing secrets → run logged with `error = 'not_configured'`; dashboard shows a
  setup hint instead of numbers. Existing table contents are kept.
- Google / parse failure → run logged with the error; the table is **not** replaced;
  the dashboard shows the last good data plus "last sync failed".
- The dashboard failing to load must never break the users table (separate fetch,
  errors contained to the dashboard card, same as the best-effort `access_limits`
  fetch).

## Testing

- `src/lib/subscriptionMetrics.test.ts` (vitest): paying/MRR including the 26
  no-price rows; churn window boundaries; lifetime with zero churn; revenue series with
  unknown starts and estimated cancels; forecast recurrence.
- `supabase/functions/_shared/subscription-sheet.test.ts` (Deno): header below a data
  row; price formats; junk in date column; status mapping; email-then-phone matching
  incl. ambiguous and deleted; estimate ladder incl. the backfill-instant exclusion and
  cancel-before-start discard.
- Live check after setup: run a sync against the real sheet and confirm the
  acceptance anchor (43 paying, ₪10,420, 26 without price, 25 cancelled, 1 failed).

## One-time setup (Yaniv)

1. Generate a token and store it as the Supabase secret `SHEET_BRIDGE_TOKEN`.
2. script.google.com (an account that can open the sheet) → new project → paste
   `scripts/sheet-bridge/Code.gs` → Script property `BRIDGE_TOKEN` = the same token →
   run `authorize` once.
3. Deploy → Web app → Execute as **Me**, access **Anyone** → store the `/exec` URL as
   the Supabase secret `SHEET_BRIDGE_URL`.

## Out of scope

- Editing subscriptions inside the portal; writing back to the sheet.
- Per-payment history (actual charges, failed-payment retries) — the sheet has none.
- Parsing the free-text notes column (`בוטל חודש 10`) into dates.
- LTV in money, cohort charts, per-course revenue.
