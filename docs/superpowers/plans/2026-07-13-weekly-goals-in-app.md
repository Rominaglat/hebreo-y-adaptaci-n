# Weekly Goals (In-App) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a student set a personal weekly study goal (hours or lessons) and see live progress against it on the Dashboard, with an opt-in for the (later) weekly email.

**Architecture:** A new `student_goals` table (RLS: owner-only) holds the plan. All progress/tier math lives in a pure, vitest-tested module `src/lib/weeklyGoal.ts`. A `useWeeklyGoal` hook reads the goal + the student's own `lesson_completions` for the current week and computes live progress via that module. A `GoalWidget` renders empty/active states at the top of the Dashboard. The server-side `weekly_progress()` SQL function and the email pipeline are a **separate follow-up plan (Plan 2)**.

**Tech Stack:** Vite + React 19, TypeScript, Supabase (Postgres + RLS), shadcn/ui, vitest (happy-dom), `LanguageContext` i18n (es/he/en).

## Global Constraints

- Supabase client: `import { supabase } from '@/integrations/supabase/client'`.
- Auth: `import { useAuth } from '@/contexts/AuthContext'` → `user` (`user.id`), `profile`.
- i18n: `import { useLanguage } from '@/contexts/LanguageContext'` → `const { t, language } = useLanguage()`; add keys as `'key': { he, en, es }`.
- Brand palette ONLY: Terracotta `#C4582A`, Cream `#FBF4DE`, Blue `#1E40AF`; use existing Tailwind tokens (`primary`, `accent`) which already map to these.
- Migrations: plain SQL under `supabase/migrations/`, `public.` schema, **idempotent** (guard with `IF NOT EXISTS` / `pg_constraint` checks), timestamp-prefixed filename.
- Tests: vitest, files `src/**/*.test.ts(x)`, run with `npx vitest run <path>`.
- Default lesson length constant lives in ONE TS place (`DEFAULT_LESSON_MINUTES = 30`) and is mirrored by a DB column `tenant_settings.default_lesson_minutes` (read at runtime; fall back to the TS constant).
- `student_goals.unit` ∈ `{'hours','lessons'}`; `emails_enabled` default `true` (opt-out model); `unsubscribe_token uuid` default `gen_random_uuid()`.
- Tier thresholds: `exceeded ≥1.2`, `met ≥1.0`, `close ≥0.7`, `behind >0`, `inactive =0`.

---

### Task 1: Database — `student_goals` table + settings column

**Files:**
- Create: `supabase/migrations/20260713100000_student_goals.sql`

**Interfaces:**
- Produces: table `public.student_goals(user_id uuid PK, unit text, target numeric, emails_enabled bool, unsubscribe_token uuid, created_at, updated_at)`; column `public.tenant_settings.default_lesson_minutes int`.

- [ ] **Step 1: Write the migration**

```sql
-- Weekly study goals (in-app gamification). One active goal per student.
-- RLS: a student fully owns their own goal row; service_role bypasses RLS.

CREATE TABLE IF NOT EXISTS public.student_goals (
  user_id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  unit              text        NOT NULL CHECK (unit IN ('hours','lessons')),
  target            numeric     NOT NULL CHECK (target > 0),
  emails_enabled    boolean     NOT NULL DEFAULT true,
  unsubscribe_token uuid        NOT NULL DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- keep updated_at fresh
CREATE OR REPLACE FUNCTION public.touch_student_goals_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_student_goals_touch ON public.student_goals;
CREATE TRIGGER trg_student_goals_touch
  BEFORE UPDATE ON public.student_goals
  FOR EACH ROW EXECUTE FUNCTION public.touch_student_goals_updated_at();

ALTER TABLE public.student_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS student_goals_select_own ON public.student_goals;
CREATE POLICY student_goals_select_own ON public.student_goals
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS student_goals_insert_own ON public.student_goals;
CREATE POLICY student_goals_insert_own ON public.student_goals
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS student_goals_update_own ON public.student_goals;
CREATE POLICY student_goals_update_own ON public.student_goals
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS student_goals_delete_own ON public.student_goals;
CREATE POLICY student_goals_delete_own ON public.student_goals
  FOR DELETE USING (auth.uid() = user_id);

-- admin-configurable default lesson length (used to convert lessons <-> hours)
ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS default_lesson_minutes int NOT NULL DEFAULT 30;
```

- [ ] **Step 2: Verify (apply + inspect)**

Run: `npx supabase db push` (or the project's migration apply flow against a linked/local DB).
Expected: no error; then `select * from public.student_goals limit 0;` succeeds and
`select default_lesson_minutes from public.tenant_settings;` returns `30`.
If no DB is reachable in this session, verify by review and apply at deploy time.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260713100000_student_goals.sql
git commit -m "feat(db): student_goals table + RLS + tenant_settings.default_lesson_minutes"
```

---

### Task 2: Pure logic — `src/lib/weeklyGoal.ts` (TDD core)

**Files:**
- Create: `src/lib/weeklyGoal.ts`
- Test: `src/lib/weeklyGoal.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_LESSON_MINUTES = 30`
  - `type GoalUnit = 'hours' | 'lessons'`
  - `type Tier = 'exceeded' | 'met' | 'close' | 'behind' | 'inactive'`
  - `interface CompletedLesson { durationMinutes: number | null }`
  - `interface Goal { unit: GoalUnit; target: number }`
  - `interface Progress { lessonsDone: number; minutesDone: number; hoursDone: number; actual: number; pct: number; tier: Tier }`
  - `minutesForCompletions(items: CompletedLesson[], defaultMinutes?: number): number`
  - `tierFor(pct: number): Tier`
  - `lessonsForHours(hours: number, defaultMinutes?: number): number`
  - `computeWeeklyProgress(items: CompletedLesson[], goal: Goal, defaultMinutes?: number): Progress`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/weeklyGoal.test.ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LESSON_MINUTES, minutesForCompletions, tierFor,
  lessonsForHours, computeWeeklyProgress,
} from './weeklyGoal';

describe('weeklyGoal', () => {
  it('sums minutes, using default when duration is missing', () => {
    expect(minutesForCompletions([{ durationMinutes: 40 }, { durationMinutes: null }]))
      .toBe(40 + DEFAULT_LESSON_MINUTES);
    expect(minutesForCompletions([], 25)).toBe(0);
  });

  it('maps pct to tiers at the boundaries', () => {
    expect(tierFor(0)).toBe('inactive');
    expect(tierFor(0.01)).toBe('behind');
    expect(tierFor(0.69)).toBe('behind');
    expect(tierFor(0.7)).toBe('close');
    expect(tierFor(0.99)).toBe('close');
    expect(tierFor(1)).toBe('met');
    expect(tierFor(1.19)).toBe('met');
    expect(tierFor(1.2)).toBe('exceeded');
  });

  it('converts an hours target into a lesson count', () => {
    expect(lessonsForHours(10, 30)).toBe(20); // 10h = 600min / 30 = 20
    expect(lessonsForHours(0, 30)).toBe(0);
  });

  it('computes progress for an hours goal', () => {
    const items = Array.from({ length: 14 }, () => ({ durationMinutes: 30 }));
    const p = computeWeeklyProgress(items, { unit: 'hours', target: 10 });
    expect(p.lessonsDone).toBe(14);
    expect(p.minutesDone).toBe(420);
    expect(p.hoursDone).toBe(7);
    expect(p.actual).toBe(7);      // unit=hours -> actual is hours
    expect(p.pct).toBeCloseTo(0.7);
    expect(p.tier).toBe('close');
  });

  it('computes progress for a lessons goal', () => {
    const items = Array.from({ length: 5 }, () => ({ durationMinutes: null }));
    const p = computeWeeklyProgress(items, { unit: 'lessons', target: 4 });
    expect(p.actual).toBe(5);      // unit=lessons -> actual is lessons count
    expect(p.tier).toBe('exceeded'); // 5/4 = 1.25
  });

  it('is safe when nothing was completed', () => {
    const p = computeWeeklyProgress([], { unit: 'hours', target: 10 });
    expect(p.pct).toBe(0);
    expect(p.tier).toBe('inactive');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/weeklyGoal.test.ts`
Expected: FAIL — "Failed to resolve import './weeklyGoal'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/weeklyGoal.ts
export const DEFAULT_LESSON_MINUTES = 30;

export type GoalUnit = 'hours' | 'lessons';
export type Tier = 'exceeded' | 'met' | 'close' | 'behind' | 'inactive';

export interface CompletedLesson { durationMinutes: number | null }
export interface Goal { unit: GoalUnit; target: number }
export interface Progress {
  lessonsDone: number; minutesDone: number; hoursDone: number;
  actual: number; pct: number; tier: Tier;
}

export function minutesForCompletions(
  items: CompletedLesson[], defaultMinutes = DEFAULT_LESSON_MINUTES,
): number {
  return items.reduce((sum, it) => sum + (it.durationMinutes ?? defaultMinutes), 0);
}

export function tierFor(pct: number): Tier {
  if (pct <= 0) return 'inactive';
  if (pct >= 1.2) return 'exceeded';
  if (pct >= 1) return 'met';
  if (pct >= 0.7) return 'close';
  return 'behind';
}

export function lessonsForHours(hours: number, defaultMinutes = DEFAULT_LESSON_MINUTES): number {
  if (hours <= 0 || defaultMinutes <= 0) return 0;
  return Math.round((hours * 60) / defaultMinutes);
}

export function computeWeeklyProgress(
  items: CompletedLesson[], goal: Goal, defaultMinutes = DEFAULT_LESSON_MINUTES,
): Progress {
  const lessonsDone = items.length;
  const minutesDone = minutesForCompletions(items, defaultMinutes);
  const hoursDone = minutesDone / 60;
  const actual = goal.unit === 'hours' ? hoursDone : lessonsDone;
  const pct = goal.target > 0 ? actual / goal.target : 0;
  return { lessonsDone, minutesDone, hoursDone, actual, pct, tier: tierFor(pct) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/weeklyGoal.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/weeklyGoal.ts src/lib/weeklyGoal.test.ts
git commit -m "feat(goals): pure weekly-progress + tier logic with tests"
```

---

### Task 3: Supabase types — register `student_goals`

**Files:**
- Modify: `src/integrations/supabase/types.ts` (add table to `Database['public']['Tables']`)

**Interfaces:**
- Produces: typed `student_goals` Row/Insert/Update so `supabase.from('student_goals')` is typed.

- [ ] **Step 1: Add the table type**

Locate `Tables: {` inside `public:` and add this entry (alongside existing tables):

```ts
      student_goals: {
        Row: {
          user_id: string
          unit: 'hours' | 'lessons'
          target: number
          emails_enabled: boolean
          unsubscribe_token: string
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          unit: 'hours' | 'lessons'
          target: number
          emails_enabled?: boolean
          unsubscribe_token?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          unit?: 'hours' | 'lessons'
          target?: number
          emails_enabled?: boolean
          unsubscribe_token?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `student_goals`.

- [ ] **Step 3: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore(types): register student_goals table type"
```

---

### Task 4: Hook — `src/hooks/useWeeklyGoal.ts`

**Files:**
- Create: `src/hooks/useWeeklyGoal.ts`

**Interfaces:**
- Consumes: `computeWeeklyProgress`, `Goal`, `GoalUnit`, `Progress`, `DEFAULT_LESSON_MINUTES` (Task 2); `supabase` client; `useAuth`.
- Produces:
  - `interface WeeklyGoalState { goal: { unit: GoalUnit; target: number; emailsEnabled: boolean } | null; progress: Progress | null; defaultLessonMinutes: number; loading: boolean }`
  - `function useWeeklyGoal(): WeeklyGoalState & { saveGoal(unit: GoalUnit, target: number, emailsEnabled: boolean): Promise<void>; setEmailsEnabled(v: boolean): Promise<void>; reload(): Promise<void> }`
  - helper `startOfIsoWeek(d: Date): Date` (Monday 00:00 local)

- [ ] **Step 1: Write helper test**

```ts
// src/hooks/useWeeklyGoal.test.ts
import { describe, it, expect } from 'vitest';
import { startOfIsoWeek } from './useWeeklyGoal';

describe('startOfIsoWeek', () => {
  it('returns Monday 00:00 for any weekday', () => {
    // 2026-07-15 is a Wednesday
    const wed = new Date(2026, 6, 15, 13, 30);
    const mon = startOfIsoWeek(wed);
    expect(mon.getDay()).toBe(1);          // Monday
    expect(mon.getDate()).toBe(13);
    expect(mon.getHours()).toBe(0);
  });
  it('treats Sunday as the end of the ISO week (previous Monday)', () => {
    const sun = new Date(2026, 6, 19, 9, 0); // Sunday
    expect(startOfIsoWeek(sun).getDate()).toBe(13);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useWeeklyGoal.test.ts`
Expected: FAIL — cannot resolve `startOfIsoWeek`.

- [ ] **Step 3: Implement the hook**

```ts
// src/hooks/useWeeklyGoal.ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  computeWeeklyProgress, DEFAULT_LESSON_MINUTES,
  type GoalUnit, type Progress,
} from '@/lib/weeklyGoal';

export function startOfIsoWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay();            // 0=Sun..6=Sat
  const diff = (dow + 6) % 7;        // days since Monday
  x.setDate(x.getDate() - diff);
  return x;
}

interface GoalRow { unit: GoalUnit; target: number; emailsEnabled: boolean }

export interface WeeklyGoalState {
  goal: GoalRow | null;
  progress: Progress | null;
  defaultLessonMinutes: number;
  loading: boolean;
}

export function useWeeklyGoal() {
  const { user } = useAuth();
  const [state, setState] = useState<WeeklyGoalState>({
    goal: null, progress: null, defaultLessonMinutes: DEFAULT_LESSON_MINUTES, loading: true,
  });

  const reload = useCallback(async () => {
    if (!user) { setState(s => ({ ...s, loading: false })); return; }
    setState(s => ({ ...s, loading: true }));

    const [{ data: goalRow }, { data: settings }] = await Promise.all([
      supabase.from('student_goals').select('unit, target, emails_enabled').eq('user_id', user.id).maybeSingle(),
      supabase.from('tenant_settings').select('default_lesson_minutes').maybeSingle(),
    ]);
    const defMin = settings?.default_lesson_minutes ?? DEFAULT_LESSON_MINUTES;

    let progress: Progress | null = null;
    let goal: GoalRow | null = null;
    if (goalRow) {
      goal = { unit: goalRow.unit, target: Number(goalRow.target), emailsEnabled: goalRow.emails_enabled };
      const weekStart = startOfIsoWeek(new Date());
      const { data: completions } = await supabase
        .from('lesson_completions')
        .select('lesson_id, completed_at, lessons(duration_minutes)')
        .eq('user_id', user.id)
        .gte('completed_at', weekStart.toISOString());
      const items = (completions ?? []).map((c: { lessons: { duration_minutes: number | null } | null }) => ({
        durationMinutes: c.lessons?.duration_minutes ?? null,
      }));
      progress = computeWeeklyProgress(items, { unit: goal.unit, target: goal.target }, defMin);
    }
    setState({ goal, progress, defaultLessonMinutes: defMin, loading: false });
  }, [user]);

  useEffect(() => { void reload(); }, [reload]);

  const saveGoal = useCallback(async (unit: GoalUnit, target: number, emailsEnabled: boolean) => {
    if (!user) return;
    await supabase.from('student_goals').upsert(
      { user_id: user.id, unit, target, emails_enabled: emailsEnabled },
      { onConflict: 'user_id' },
    );
    await reload();
  }, [user, reload]);

  const setEmailsEnabled = useCallback(async (v: boolean) => {
    if (!user) return;
    await supabase.from('student_goals').update({ emails_enabled: v }).eq('user_id', user.id);
    await reload();
  }, [user, reload]);

  return { ...state, saveGoal, setEmailsEnabled, reload };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useWeeklyGoal.test.ts`
Expected: PASS (2 tests). Then `npx tsc --noEmit` → no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useWeeklyGoal.ts src/hooks/useWeeklyGoal.test.ts
git commit -m "feat(goals): useWeeklyGoal hook (read/write goal + live weekly progress)"
```

---

### Task 5: i18n strings for the widget

**Files:**
- Modify: `src/contexts/LanguageContext.tsx` (add keys to the translations map)

**Interfaces:**
- Produces: `t('goal.*')` keys used by `GoalWidget` (Task 6).

- [ ] **Step 1: Add the keys**

Add these entries alongside the existing `'streak.*'` keys (same object shape `{ he, en, es }`):

```ts
  'goal.widget.setTitle':   { he: 'הגדרת יעד שבועי', en: 'Set your weekly goal', es: 'Define tu meta semanal' },
  'goal.widget.setDesc':    { he: 'קבע יעד ואנחנו נעזור לך לעמוד בו, שבוע אחר שבוע.', en: 'Set a goal and we\'ll help you reach it, week by week.', es: 'Ponte un objetivo y te ayudamos a cumplirlo, semana a semana.' },
  'goal.unit.hours':        { he: 'שעות', en: 'Hours', es: 'Horas' },
  'goal.unit.lessons':      { he: 'שיעורים', en: 'Lessons', es: 'Lecciones' },
  'goal.widget.perWeekHours': { he: 'שעות בשבוע', en: 'hours per week', es: 'horas por semana' },
  'goal.widget.perWeekLessons': { he: 'שיעורים בשבוע', en: 'lessons per week', es: 'lecciones por semana' },
  'goal.widget.approxLessons': { he: '≈ {n} שיעורים', en: '≈ {n} lessons', es: '≈ {n} lecciones' },
  'goal.widget.emailOptin': { he: '📬 שלחו לי סיכום שבועי במייל', en: '📬 Email me a weekly summary', es: '📬 Enviarme un resumen semanal por correo' },
  'goal.widget.save':       { he: 'שמירת היעד', en: 'Save my goal', es: 'Guardar mi meta' },
  'goal.widget.title':      { he: 'היעד השבועי שלי', en: 'My weekly goal', es: 'Mi meta semanal' },
  'goal.widget.edit':       { he: 'עריכה', en: 'Edit', es: 'Editar' },
  'goal.widget.ofHours':    { he: '{done} / {target} שע׳', en: '{done} / {target} h', es: '{done} / {target} h' },
  'goal.widget.ofLessons':  { he: '{done} / {target} שיעורים', en: '{done} / {target} lessons', es: '{done} / {target} lecciones' },
  'goal.widget.remaining':  { he: 'נותרו לך {n} להשלמת היעד 💪', en: '{n} to go to reach your goal 💪', es: 'Te faltan {n} para cumplir tu meta 💪' },
  'goal.widget.done':       { he: 'עמדת ביעד השבוע! 🎯', en: 'Goal reached this week! 🎯', es: '¡Meta cumplida esta semana! 🎯' },
  'goal.widget.hoursShort': { he: 'שע׳', en: 'h', es: 'h' },
  'goal.widget.lessonsShort': { he: 'שיעורים', en: 'lessons', es: 'lecciones' },
```

- [ ] **Step 2: Verify typecheck & lint**

Run: `npx tsc --noEmit && npx eslint src/contexts/LanguageContext.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/contexts/LanguageContext.tsx
git commit -m "i18n(goals): add goal widget strings (he/en/es)"
```

---

### Task 6: `GoalWidget` component (empty + active states)

**Files:**
- Create: `src/components/GoalWidget.tsx`

**Interfaces:**
- Consumes: `useWeeklyGoal` (Task 4); `useLanguage`; shadcn `Card`, `Button`, `Checkbox`, `ToggleGroup`/buttons; `lessonsForHours`, `DEFAULT_LESSON_MINUTES` (Task 2).
- Produces: default export `GoalWidget` (no props) — used by Dashboard (Task 7).

- [ ] **Step 1: Implement the component**

```tsx
// src/components/GoalWidget.tsx
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWeeklyGoal } from '@/hooks/useWeeklyGoal';
import { lessonsForHours, type GoalUnit } from '@/lib/weeklyGoal';
import { cn } from '@/lib/utils';

function ProgressRing({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(1, pct));
  const r = 56, c = 2 * Math.PI * r, off = c * (1 - clamped);
  return (
    <svg width="150" height="150" viewBox="0 0 150 150" className="mx-auto">
      <circle cx="75" cy="75" r={r} fill="none" stroke="#F1E7D6" strokeWidth="15" />
      <circle cx="75" cy="75" r={r} fill="none" stroke="url(#goalgrad)" strokeWidth="15"
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off}
        transform="rotate(-90 75 75)" />
      <text x="75" y="72" textAnchor="middle" fontSize="32" fontWeight="800" fill="#2A2320">
        {Math.round(clamped * 100)}%
      </text>
      <defs>
        <linearGradient id="goalgrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#C4582A" /><stop offset="1" stopColor="#E0864F" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default function GoalWidget() {
  const { t } = useLanguage();
  const { goal, progress, defaultLessonMinutes, loading, saveGoal, reload } = useWeeklyGoal();
  const [editing, setEditing] = useState(false);
  const [unit, setUnit] = useState<GoalUnit>('hours');
  const [target, setTarget] = useState(10);
  const [emails, setEmails] = useState(true);
  const [saving, setSaving] = useState(false);

  if (loading) return <Card className="p-6 animate-pulse h-40" />;

  const showForm = editing || !goal;

  if (showForm) {
    const approx = unit === 'hours' ? lessonsForHours(target, defaultLessonMinutes) : null;
    return (
      <Card className="p-6">
        <h3 className="text-lg font-extrabold text-foreground mb-1">🎯 {t('goal.widget.setTitle')}</h3>
        <p className="text-sm text-muted-foreground mb-4">{t('goal.widget.setDesc')}</p>

        <div className="flex bg-secondary/60 rounded-xl p-1 mb-4">
          {(['hours', 'lessons'] as GoalUnit[]).map(u => (
            <button key={u} onClick={() => setUnit(u)}
              className={cn('flex-1 py-2 rounded-lg font-bold text-sm transition',
                unit === u ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
              {t(u === 'hours' ? 'goal.unit.hours' : 'goal.unit.lessons')}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-center gap-4 mb-1">
          <Button type="button" variant="outline" size="icon" onClick={() => setTarget(v => Math.max(1, v - 1))}>–</Button>
          <span className="text-4xl font-extrabold text-foreground w-16 text-center">{target}</span>
          <Button type="button" variant="outline" size="icon" onClick={() => setTarget(v => v + 1)}>+</Button>
        </div>
        <p className="text-center text-sm text-muted-foreground mb-4">
          {t(unit === 'hours' ? 'goal.widget.perWeekHours' : 'goal.widget.perWeekLessons')}
          {approx != null && <> · {t('goal.widget.approxLessons').replace('{n}', String(approx))}</>}
        </p>

        <label className="flex items-center gap-3 bg-secondary/40 rounded-lg p-3 mb-4 cursor-pointer">
          <Checkbox checked={emails} onCheckedChange={v => setEmails(Boolean(v))} />
          <span className="text-sm text-foreground">{t('goal.widget.emailOptin')}</span>
        </label>

        <Button className="w-full font-bold" disabled={saving}
          onClick={async () => { setSaving(true); await saveGoal(unit, target, emails); setSaving(false); setEditing(false); }}>
          {t('goal.widget.save')}
        </Button>
      </Card>
    );
  }

  const p = progress!;
  const doneStr = goal!.unit === 'hours' ? p.hoursDone.toFixed(p.hoursDone % 1 ? 1 : 0) : String(p.lessonsDone);
  const ofKey = goal!.unit === 'hours' ? 'goal.widget.ofHours' : 'goal.widget.ofLessons';
  const remainingAmount = Math.max(0, goal!.target - p.actual);
  const remainingUnit = t(goal!.unit === 'hours' ? 'goal.widget.hoursShort' : 'goal.widget.lessonsShort');

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-extrabold text-foreground">{t('goal.widget.title')}</h3>
        <button className="text-sm font-bold text-primary" onClick={() => {
          setUnit(goal!.unit); setTarget(goal!.target); setEmails(goal!.emailsEnabled); setEditing(true);
        }}>{t('goal.widget.edit')}</button>
      </div>
      <ProgressRing pct={p.pct} />
      <p className="text-center text-sm text-foreground mt-2">
        {t(ofKey).replace('{done}', doneStr).replace('{target}', String(goal!.target))}
      </p>
      <p className="text-center text-sm text-muted-foreground mt-1">
        {remainingAmount <= 0
          ? t('goal.widget.done')
          : t('goal.widget.remaining').replace('{n}', `${remainingAmount % 1 ? remainingAmount.toFixed(1) : remainingAmount} ${remainingUnit}`)}
      </p>
    </Card>
  );
}
```

- [ ] **Step 2: Verify typecheck & lint**

Run: `npx tsc --noEmit && npx eslint src/components/GoalWidget.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/GoalWidget.tsx
git commit -m "feat(goals): GoalWidget (set + track weekly goal)"
```

---

### Task 7: Mount `GoalWidget` at the top of the Dashboard

**Files:**
- Modify: `src/pages/Dashboard.tsx` (add import; render `<GoalWidget />` inside the top container at `~line 353`, right after the opening `<div className="space-y-5 ...">`)

**Interfaces:**
- Consumes: `GoalWidget` (Task 6).

- [ ] **Step 1: Add the import**

Near the other component imports (by `StreakIndicator` at line 23):

```tsx
import GoalWidget from '@/components/GoalWidget';
```

- [ ] **Step 2: Render it at the top of the content column**

Immediately after the opening `<div className="space-y-5 sm:space-y-6 w-full min-w-0">` (line ~353), insert:

```tsx
        <GoalWidget />
```

- [ ] **Step 3: Verify in the app**

Run: `npm run dev`, log in as a student, open the Dashboard.
Expected: the goal widget appears at the top; setting a goal shows the ring; reload persists it.
(Use the `verify` skill / `/run` to drive this end-to-end.)

- [ ] **Step 4: Commit**

```bash
git add src/pages/Dashboard.tsx
git commit -m "feat(goals): show GoalWidget at top of Dashboard"
```

---

### Task 8: Profile toggle for the weekly-email opt-in

**Files:**
- Modify: `src/pages/Profile.tsx` (add a Switch bound to `emails_enabled` via `useWeeklyGoal`)

**Interfaces:**
- Consumes: `useWeeklyGoal` → `goal.emailsEnabled`, `setEmailsEnabled` (Task 4); shadcn `Switch`; `useLanguage`.

- [ ] **Step 1: Add i18n keys**

In `src/contexts/LanguageContext.tsx` add:

```ts
  'goal.profile.emailLabel': { he: 'סיכום התקדמות שבועי במייל', en: 'Weekly progress email', es: 'Resumen semanal por correo' },
  'goal.profile.emailHint':  { he: 'נשלח רק אם הגדרת יעד שבועי.', en: 'Sent only if you have a weekly goal.', es: 'Se envía solo si tienes una meta semanal.' },
```

- [ ] **Step 2: Render the toggle**

Add near the other preference rows in `Profile.tsx` (inside the settings/preferences card):

```tsx
// at top with other imports
import { Switch } from '@/components/ui/switch';
import { useWeeklyGoal } from '@/hooks/useWeeklyGoal';

// inside the component body
const { goal, setEmailsEnabled } = useWeeklyGoal();

// in the preferences JSX
{goal && (
  <div className="flex items-center justify-between py-3">
    <div>
      <p className="font-medium text-foreground">{t('goal.profile.emailLabel')}</p>
      <p className="text-sm text-muted-foreground">{t('goal.profile.emailHint')}</p>
    </div>
    <Switch checked={goal.emailsEnabled} onCheckedChange={v => void setEmailsEnabled(v)} />
  </div>
)}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`; then in the app, toggle the switch and confirm the DB row's
`emails_enabled` flips (Supabase table view or refetch).

- [ ] **Step 4: Commit**

```bash
git add src/pages/Profile.tsx src/contexts/LanguageContext.tsx
git commit -m "feat(goals): profile toggle for weekly email opt-in"
```

---

### Task 9: Capture `duration_minutes` in the lesson editor

**Files:**
- Modify: `src/components/LessonForm.tsx` (add a minutes input for `video`/`embed` lessons; include in the lesson payload)

**Interfaces:**
- Consumes: existing `LessonForm` lesson object (`lesson_type`, etc.); writes `duration_minutes` into the same insert/update path used for lessons.

- [ ] **Step 1: Add the field to the lesson type + default**

In the local lesson interface (line ~23) add `duration_minutes?: number | null;`, and in the
default lesson object (line ~864) add `duration_minutes: null,`.

- [ ] **Step 2: Render the input (video/embed only)**

Inside the `lesson.lesson_type === 'video'` block (near line 587) and the `=== 'embed'` block
(near line 765), add:

```tsx
<div className="space-y-1">
  <Label>{t('lessonForm.durationMinutes')}</Label>
  <Input type="number" min={1} value={lesson.duration_minutes ?? ''}
    onChange={e => onUpdate(moduleIndex, lessonIndex, 'duration_minutes',
      e.target.value === '' ? null : Number(e.target.value))} />
</div>
```

Add i18n key in `LanguageContext.tsx`:

```ts
  'lessonForm.durationMinutes': { he: 'משך בדקות', en: 'Duration (minutes)', es: 'Duración (minutos)' },
```

- [ ] **Step 3: Ensure it is saved**

Confirm the lesson insert/update payload in `LessonForm.tsx` (and any `EditCourse`/`CreateCourse`
save path) includes `duration_minutes: lesson.duration_minutes ?? null`. Add it where the lesson
row is built if missing.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`; then in the app, edit a video lesson, set a duration, save, reopen —
value persists; confirm the `lessons.duration_minutes` column is populated.

- [ ] **Step 5: Commit**

```bash
git add src/components/LessonForm.tsx src/contexts/LanguageContext.tsx
git commit -m "feat(lessons): capture duration_minutes in the lesson editor"
```

---

## Self-Review

**Spec coverage (§ of spec → task):** goal metric hours/lessons → T2/T4/T6; measure from
`lesson_completions` + duration/default → T2/T4; `student_goals` + RLS → T1; opt-in default true
+ profile toggle → T1/T6/T8; `default_lesson_minutes` home (spec said `platform_settings`; **corrected
to `tenant_settings`** which is the real settings table) → T1/T4; widget top of Dashboard, empty+active,
brand colors → T6/T7; duration capture + (backfill deferred to Plan 2) → T9. **Deferred to Plan 2**
(server-only): `weekly_progress()` SQL fn, `weekly_goal_snapshots`, `send-weekly-goal-summary` edge fn,
localized email templates, pg_cron, unsubscribe endpoint, duration backfill script, dry-run/admin preview.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `GoalUnit`, `Tier`, `Progress`, `computeWeeklyProgress`, `lessonsForHours`,
`startOfIsoWeek`, `useWeeklyGoal` used identically across T2/T4/T6. `emails_enabled` (DB) ↔
`emailsEnabled` (TS mapped in the hook) is intentional and consistent.

**Open verification risks (call out at execution):** (a) the `lesson_completions → lessons(duration_minutes)`
embedded select depends on the FK being introspectable by PostgREST — if it errors, fall back to a
second query fetching `lessons.duration_minutes` by `lesson_id`. (b) exact insertion lines in
`Dashboard.tsx`/`Profile.tsx`/`LessonForm.tsx` may shift; match by the anchor code shown, not line numbers.
