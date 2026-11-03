// Study-time crediting for the weekly summary email. Pure: no Deno or network
// imports, so vitest runs it beside the client copy in src/lib/weeklyGoal.ts.
// Keep the two in step — src/lib/weeklyGoal.test.ts runs the same cases
// against both.

export interface CompletedLesson {
  lessonId?: string;
  durationMinutes: number | null;
}

export interface WatchedLesson {
  lessonId: string;
  seconds: number;
}

/**
 * Each lesson earns the larger of its completion credit (its length, when
 * completed this week) and the time its video played this week, so a rewatch
 * adds time and an unmeasured completion keeps its old credit.
 */
export function creditedMinutes(
  completed: CompletedLesson[],
  watched: WatchedLesson[],
  defaultMinutes: number,
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
