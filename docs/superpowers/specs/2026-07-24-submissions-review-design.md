# Submissions Review Queue — Design

**Date:** 2026-07-24
**Status:** Approved by Yaniv (conversation), implementing on branch `feat/submissions-review`

## Problem

Reviewing student assignment submissions is Sisyphean: Romina must open
Manage Users → find a student → 3-dot menu → "View submissions" dialog →
write feedback → close → find the next student. There is no global view of
what awaits review, no counts, no filtering, and no way to move between
submissions without leaving the context.

## Decisions (from brainstorming)

- **Dedicated admin page** `/admin/submissions` with a queue + filters
  (chosen over enhancing the existing per-student dialog, or a
  realtime/React-Query build — YAGNI).
- **Split view** (email-inbox style): submission list on one pane, selected
  submission + feedback form on the other. Mobile collapses to list → detail.
- **"Save & next"** primary action: saves feedback, fires the existing
  notifications, auto-advances to the next pending submission.
- **Sidebar badge** with the pending-submissions count (admins/instructors
  only). Simple count query, refreshed on load and after saving — no realtime.
- **Voice feedback**: Romina can record an audio reply in addition to text.
  Explicitly deferred: canned feedback templates, one-click "mark reviewed
  without text".

## Architecture

### 1. New page `src/pages/admin/AdminSubmissions.tsx`

- Route `/admin/submissions` in `App.tsx` (lazy, `requireAdminOrInstructor`),
  sidebar item in `DashboardLayout.tsx` under the instructor-plus group.
- Data: one query on `assignment_submissions` with the existing
  `lessons(title, assignment_questions, modules(course_id, courses(id, title)))`
  embed; student names/avatars fetched from `profiles` by `user_id` batch
  (FK is to `auth.users`, so no PostgREST embed — same pattern as ManageUsers).
- Signed audio URLs generated in batch via `createSignedUrls` (the existing
  dialog does them serially in a loop — the new page must not).
- Filters: status (default: awaiting review), course, lesson, student-name
  search. Pending sorted oldest-first (longest-waiting on top).
- Detail pane: per-question answers + audio players, feedback textarea,
  voice-feedback recorder (`useAudioRecorder`), **Save & next** (saves →
  invokes `notify-assignment-feedback` → advances) and plain Save.

### 2. Pending badge

Count query (`status='submitted'`, head-only) in `DashboardLayout` for
staff; re-fetched on route change to/from the submissions page and via a
window event fired after a save.

### 3. Voice feedback (migration `2026….sql`)

- `assignment_submissions.feedback_audio_path text` — object path in the
  existing private `assignment-audio` bucket.
- Stored under the **student's** prefix (`{studentId}/{lessonId}/feedback.webm`)
  so the existing owner-read storage policy already lets the student play it.
- Extend `guard_assignment_feedback` trigger to also protect
  `feedback_audio_path` from non-staff writes.
- New storage policies: staff INSERT/UPDATE on `assignment-audio` (today only
  the owner can write).
- Student side: `AssignmentTaker` renders an audio player inside the
  existing "Feedback from your teacher" box; feedback box now shows when
  reviewed with either text or audio.
- `notify-assignment-feedback` edge function unchanged.

### 4. Unchanged

Data model otherwise, the per-student dialog in ManageUsers, the student
submission flow, email/announcement delivery.

## i18n

New `submissionsReview.*` strings in he/en/es; nav label `nav.submissions`.

## Testing

`npm run build` + `npm run lint`; multi-agent adversarial review of the diff
before finishing. No existing unit-test coverage for admin pages to extend.
