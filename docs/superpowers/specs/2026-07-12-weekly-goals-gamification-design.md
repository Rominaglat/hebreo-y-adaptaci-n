# Weekly Study Goals + Progress Emails — Design Spec

**Date:** 2026-07-12
**Status:** Approved design, pending implementation plan
**Author:** brainstorming session (Yaniv + Claude)

## 1. Goal & Motivation

Add lightweight gamification to the Romina Hebreo learning portal: let students set a
**personal weekly study goal**, track progress against it in-app, and receive a **weekly
email** that compares actual vs. planned progress — praising them when on track and gently
nudging them when behind. The aim is motivation and retention, not precise time-accounting.

## 2. Key Decisions (locked during brainstorming)

| Topic | Decision |
|---|---|
| Goal metric | Weekly volume goal. Student sets it in **hours or lessons** (their choice). One **global** goal (not per-course). Recurring, editable anytime. |
| How "hours" is measured | Derived from `lesson_completions`: for each lesson completed in the week, credit `lessons.duration_minutes` if set, else `platform_settings.default_lesson_minutes` (admin default, ~30). Sum ÷ 60 = hours. **No real watch-time tracking** (chosen for speed & reliability). |
| Recipients | Students who (a) have an active goal **and** (b) have the weekly-email checkbox enabled. |
| Email opt-in default | Checkbox **pre-checked (opt-out model)** when setting a goal. Editable in Profile; every email has one-click unsubscribe. |
| Cadence / timing | Weekly, **Monday 08:00** (platform timezone). Reviews the previous Mon–Sun week. |
| Channel | Email via **Resend** (existing edge-function pattern). Web-push is a future add-on. |
| Language | Rendered in the student's platform language (**es / he / en**), RTL for Hebrew. Primary audience is Spanish. |
| Email tone | Motivating and warm; **never shaming**. Even "behind"/"inactive" tiers are framed positively with one small concrete next step. |
| CTA | Single button → **the student's next uncompleted lesson** (deep link). |
| Widget placement | **Top of the Dashboard**, prominent, unified with the existing `StreakIndicator`. |
| Admin adherence view | **Out of MVP** (future: an instructor "who's falling behind" screen). |

## 3. Existing System Context (grounding facts)

- **Progress source of truth:** `lesson_completions` (binary completion + timestamp; has a
  dedup unique constraint as of `20260626000000`). This is server-side and reliable.
- **Email infra exists:** `supabase/functions/send-invite-email` uses **Resend**
  (`RESEND_API_KEY`, `REPLY_TO`) — reuse this pattern.
- **Scheduling exists:** **pg_cron** already used (`20260625000000_schedule_revoke_expired_access`).
- **Existing gamification is client-only & ephemeral:** `useStreak` stores the streak in
  **localStorage** (`streak:${user.id}`); `useAchievements` unlocks client-side. There are
  **no gamification DB tables**. Consequence: the server cannot see these, so they **cannot
  drive emails** — this feature introduces server-side truth.
- **Lesson durations are effectively empty:** `lessons.duration_minutes` exists but
  `LessonForm.tsx` never captures it → NULL on essentially all lessons. Must add capture +
  backfill for "hours" to be meaningful.
- **Access can be time-limited** (`20260623120000_access_time_limit`): expired users must be
  excluded from emails.
- **Stack:** Vite + React 19 SPA (no server API routes); Supabase (Postgres + edge functions
  + RLS); trilingual i18n via `LanguageContext`.

## 4. Architecture — Components & Boundaries

Each unit has one purpose, a clear interface, and is independently testable.

```
                 ┌─────────────────────────────────────────────┐
   Student UI    │  GoalWidget (Dashboard)  ·  Profile toggle   │
                 └───────────────┬─────────────────────────────┘
                                 │ read/write (RLS-scoped)
                 ┌───────────────▼──────────┐
   Data          │  student_goals table     │  ← the plan
                 │  weekly_goal_snapshots    │  ← weekly results / history / idempotency
                 │  lessons.duration_minutes │  ← enrichment
                 │  platform_settings.default_lesson_minutes
                 └───────────────┬──────────┘
                                 │ reads lesson_completions + durations
                 ┌───────────────▼──────────┐
   Compute       │  weekly_progress() SQL fn │  ← pure calculator (hours/lessons/pct/tier)
                 └───────────────┬──────────┘
                                 │
   Schedule      │  pg_cron  (Mon 08:00) ────► invokes edge fn
                 ┌───────────────▼──────────────────────────────┐
   Job           │  edge fn: send-weekly-goal-summary            │
                 │   1. select eligible students                 │
                 │   2. weekly_progress() per student            │
                 │   3. pick tier → render localized template    │
                 │   4. Resend send                              │
                 │   5. upsert weekly_goal_snapshots (idempotent)│
                 └───────────────┬──────────────────────────────┘
                                 │ unsubscribe links →
                 ┌───────────────▼──────────┐
   Consent       │  unsubscribe endpoint (token → emails_enabled=false, no login)
                 └──────────────────────────┘
```

### 4.1 Data model

**`student_goals`** — one active goal per student.
- `user_id uuid PK REFERENCES auth.users` (unique → one goal per student)
- `unit text NOT NULL CHECK (unit IN ('hours','lessons'))`
- `target numeric NOT NULL CHECK (target > 0)` — value in the chosen unit
- `emails_enabled boolean NOT NULL DEFAULT true` — the opt-in checkbox
- `unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid()` — for one-click unsubscribe
- `created_at`, `updated_at timestamptz`
- **RLS:** owner can select/insert/update/delete their own row; service_role full access.

**`weekly_goal_snapshots`** — one row per student per completed week.
- `id`, `user_id`, `week_start date NOT NULL` (Monday)
- `unit`, `target numeric` — copied from goal at send time
- `lessons_done int`, `minutes_done int`, `hours_done numeric`
- `pct numeric` — actual ÷ target (in the goal's unit)
- `tier text` — `exceeded|met|close|behind|inactive`
- `sent_at timestamptz`, `resend_id text`, `email_status text`
- **UNIQUE (user_id, week_start)** → idempotency (a re-run never double-sends).
- **RLS:** owner reads own; service_role writes.

**Extensions to existing objects**
- `lessons.duration_minutes` — start capturing it in `LessonForm`; backfill existing rows.
- `platform_settings.default_lesson_minutes int DEFAULT 30` — admin-configurable fallback.

### 4.2 Progress calculator — `weekly_progress(p_user uuid, p_week_start date)`

Pure SQL function returning `(lessons_done, minutes_done, hours_done, target, unit, pct, tier)`.
- Counts `lesson_completions` for the user in `[week_start, week_start + 7)`.
- `minutes_done = Σ COALESCE(lessons.duration_minutes, default_lesson_minutes)`.
- `pct` = actual ÷ target, where "actual" is `hours_done` or `lessons_done` per the goal's unit.
- `tier` by `pct`: `exceeded ≥1.2`, `met ≥1.0`, `close ≥0.7`, `behind >0`, `inactive =0`
  (thresholds are constants, easy to tune).
- Testable in isolation with seeded completions/durations.

### 4.3 Weekly job — edge fn `send-weekly-goal-summary`

Triggered by pg_cron Monday 08:00 (platform tz). For the just-ended week:
1. Select students with `emails_enabled = true`, an active goal, and **non-expired access**,
   who **don't already have a snapshot** for this `week_start` (idempotency).
2. For each: call `weekly_progress()`, compute trend vs. prior snapshot and current
   consecutive-weeks-met streak, resolve their language, resolve **next uncompleted lesson**.
3. Render the localized template for the tier; send via Resend.
4. Upsert the `weekly_goal_snapshots` row with result + `resend_id`.
- Batched, rate-limit-aware; a per-student failure is logged and does not abort the run.
- Supports a **dry-run / preview mode** (render + return HTML, no send) for testing and for an
  admin "send me a test" action.

### 4.4 Email renderer (localized)

- Shared strings for **es/he/en** (the edge fn cannot import client `LanguageContext`; use a
  small shared JSON/module). RTL layout for `he`.
- Anatomy (content varies by tier): personal greeting · hero stat + progress bar · streak of
  weeks (shown only if ≥1) · week-over-week trend · single CTA (next lesson) · footer
  (manage preferences + one-click unsubscribe).
- Brand palette only: Terracotta `#C4582A`, Cream `#FBF4DE`, brown accents. Tier is signaled
  by badge + copy, **not** by hue-swapping. (Validated in visual mockups.)

### 4.5 In-app UI

- **`GoalWidget`** (new) at the top of `Dashboard.tsx`:
  - *Empty state:* unit toggle (Horas/Lecciones), number stepper with live conversion
    (`10 h ≈ 20 lecciones` using `default_lesson_minutes`), pre-checked email opt-in checkbox,
    "Guardar mi meta".
  - *Active state:* progress ring (pct + `done/target`), "te faltan X", consecutive-weeks
    chip, last-weeks dots (met/missed/current), "Editar".
- **Profile:** a "📬 Weekly summary email" toggle mirroring `student_goals.emails_enabled`.
- Uses the existing brand tokens; sits beside the existing `StreakIndicator`.
- New hook `useWeeklyGoal` (read/write the goal + this-week live progress via
  `weekly_progress()` RPC).

### 4.6 Unsubscribe endpoint

- Token link `…/unsubscribe?token=<uuid>` → sets `emails_enabled=false`. Works **without
  login** (matches the token to `student_goals.unsubscribe_token`). Implemented as an edge
  function (or public route) returning a simple localized confirmation page.

## 5. Enabling work: lesson duration capture + backfill

1. Add a `duration_minutes` input to `LessonForm.tsx` (video/embed lessons; optional field).
2. **Backfill:** one-time script/edge fn — for `video`/`embed` lessons with a Vimeo/YouTube
   `embed_url`, fetch real duration via oEmbed/API; others left NULL (fall back to default).
3. `platform_settings.default_lesson_minutes` editable in the admin PlatformSettings page.

## 6. Edge cases & safety

- **No goal** → not emailed; widget invites the student to set one.
- **Opted out / unsubscribed** → skipped.
- **Access expired** (time-limited access) → skipped.
- **Idempotency** → `UNIQUE(user_id, week_start)` on snapshots prevents double-sends on retry.
- **Timezone** → MVP uses one platform-level week boundary; per-user timezone is future.
- **Privacy** → snapshots store only aggregate progress; unsubscribe honored immediately.

## 7. Targeted improvement (in scope, minimal)

The email/snapshots establish **server-side** progress truth. The existing `StreakIndicator`
is localStorage-only, so the app and email could disagree. In scope: derive
"consecutive-weeks-met" server-side from snapshots for the widget/email. **Fast-follow (noted,
not blocking):** migrate the daily `useStreak` to a server-derived activity signal from
`lesson_completions` so the daily streak is cross-device and consistent.

## 8. Out of scope (MVP)

Per-course goals · per-user timezones · web-push channel · instructor/admin adherence
dashboard · real watch-time tracking.

## 9. Testing strategy

- **Unit:** `weekly_progress()` against seeded completions/durations → correct hours, pct, tier
  (all five tiers, hours vs lessons unit, missing-duration fallback).
- **Edge fn:** dry-run render per tier × language (es/he/en, incl. RTL); Resend mocked;
  eligibility filters (opted-out / expired / no-goal / already-sent) verified.
- **Idempotency:** running the job twice for the same week sends once.
- **UI:** widget empty↔active states; set/edit goal; opt-in toggle round-trips to DB.
- **Unsubscribe:** token link flips `emails_enabled` without a session.

## 10. Suggested build phases (for the implementation plan)

1. **Data + calculator:** tables, RLS, `platform_settings.default_lesson_minutes`,
   `weekly_progress()` + tests.
2. **Goal UI:** `useWeeklyGoal`, `GoalWidget` (both states), Profile toggle.
3. **Duration enablement:** `LessonForm` field + backfill script.
4. **Weekly email:** `send-weekly-goal-summary` edge fn, localized templates, snapshots,
   pg_cron schedule, unsubscribe endpoint, dry-run/admin preview.
