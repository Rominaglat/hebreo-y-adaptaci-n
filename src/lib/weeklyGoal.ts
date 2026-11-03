// Pure logic for weekly study goals. No I/O — safe to unit-test and to import
// from both the client hook and (mirrored) the server email job.

export const DEFAULT_LESSON_MINUTES = 30;

export type GoalUnit = 'hours' | 'lessons';
export type Tier = 'exceeded' | 'met' | 'close' | 'behind' | 'inactive';

export interface CompletedLesson {
  lessonId?: string;
  durationMinutes: number | null;
}
/** Seconds a lesson video played (one row per lesson per day in lesson_watch_time). */
export interface WatchedLesson {
  lessonId: string;
  seconds: number;
}
export interface Goal {
  unit: GoalUnit;
  target: number;
}
export interface Progress {
  lessonsDone: number;
  minutesDone: number;
  hoursDone: number;
  actual: number; // hours when unit=hours, lesson count when unit=lessons
  pct: number;
  tier: Tier;
  watchMinutes: number; // measured video play time, rewatches included
}

export function minutesForCompletions(
  items: CompletedLesson[],
  defaultMinutes = DEFAULT_LESSON_MINUTES,
): number {
  return items.reduce((sum, it) => sum + (it.durationMinutes ?? defaultMinutes), 0);
}

/**
 * Study minutes for a week. Each lesson earns the larger of its completion
 * credit (its length, when completed this week) and the time its video
 * actually played this week. A rewatch therefore adds time, while a lesson
 * finished without playback being measured (a file, an exam, a skipped-to-end
 * video) still earns exactly what it did before watch time existed.
 * Mirrored in supabase/functions/_shared/study-time.ts for the weekly email.
 */
export function creditedMinutes(
  completed: CompletedLesson[],
  watched: WatchedLesson[],
  defaultMinutes = DEFAULT_LESSON_MINUTES,
): number {
  const byLesson = new Map<string, { completion: number; watched: number }>();
  let unmatched = 0;
  for (const c of completed) {
    const credit = c.durationMinutes ?? defaultMinutes;
    if (!c.lessonId) { unmatched += credit; continue; }
    const cur = byLesson.get(c.lessonId) ?? { completion: 0, watched: 0 };
    cur.completion = Math.max(cur.completion, credit);
    byLesson.set(c.lessonId, cur);
  }
  for (const w of watched) {
    const cur = byLesson.get(w.lessonId) ?? { completion: 0, watched: 0 };
    cur.watched += w.seconds / 60;
    byLesson.set(w.lessonId, cur);
  }
  let total = unmatched;
  for (const l of byLesson.values()) total += Math.max(l.completion, l.watched);
  return Math.round(total);
}

/** Lessons finished before this week that the student came back to for at least a minute. */
export function countReviewedLessons(
  watched: WatchedLesson[],
  completedBefore: ReadonlySet<string>,
  minSeconds = 60,
): number {
  const perLesson = new Map<string, number>();
  for (const w of watched) perLesson.set(w.lessonId, (perLesson.get(w.lessonId) ?? 0) + w.seconds);
  let n = 0;
  for (const [lessonId, seconds] of perLesson) {
    if (seconds >= minSeconds && completedBefore.has(lessonId)) n++;
  }
  return n;
}

export function tierFor(pct: number): Tier {
  if (pct <= 0) return 'inactive';
  if (pct >= 1.2) return 'exceeded';
  if (pct >= 1) return 'met';
  if (pct >= 0.7) return 'close';
  return 'behind';
}

/** "1 h 20 min", "45 min", "2 h" — labels come from the caller's language. */
export function formatMinutes(minutes: number, hoursLabel: string, minutesLabel: string): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} ${minutesLabel}`;
  return m === 0 ? `${h} ${hoursLabel}` : `${h} ${hoursLabel} ${m} ${minutesLabel}`;
}

export function lessonsForHours(hours: number, defaultMinutes = DEFAULT_LESSON_MINUTES): number {
  if (hours <= 0 || defaultMinutes <= 0) return 0;
  return Math.round((hours * 60) / defaultMinutes);
}

export function computeWeeklyProgress(
  items: CompletedLesson[],
  goal: Goal,
  defaultMinutes = DEFAULT_LESSON_MINUTES,
  watched: WatchedLesson[] = [],
): Progress {
  const lessonsDone = items.length;
  const minutesDone = creditedMinutes(items, watched, defaultMinutes);
  const hoursDone = minutesDone / 60;
  const actual = goal.unit === 'hours' ? hoursDone : lessonsDone;
  const pct = goal.target > 0 ? actual / goal.target : 0;
  const watchMinutes = Math.round(watched.reduce((sum, w) => sum + w.seconds, 0) / 60);
  return { lessonsDone, minutesDone, hoursDone, actual, pct, tier: tierFor(pct), watchMinutes };
}

/** Monday 00:00 (local) of the ISO week containing `d`. Sunday belongs to the week that started the prior Monday. */
export function startOfIsoWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay(); // 0=Sun..6=Sat
  const diff = (dow + 6) % 7; // days since Monday
  x.setDate(x.getDate() - diff);
  return x;
}
