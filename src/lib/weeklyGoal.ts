// Pure logic for weekly study goals. No I/O — safe to unit-test and to import
// from both the client hook and (mirrored) the server email job.

export const DEFAULT_LESSON_MINUTES = 30;

export type GoalUnit = 'hours' | 'lessons';
export type Tier = 'exceeded' | 'met' | 'close' | 'behind' | 'inactive';

export interface CompletedLesson {
  durationMinutes: number | null;
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
}

export function minutesForCompletions(
  items: CompletedLesson[],
  defaultMinutes = DEFAULT_LESSON_MINUTES,
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
  items: CompletedLesson[],
  goal: Goal,
  defaultMinutes = DEFAULT_LESSON_MINUTES,
): Progress {
  const lessonsDone = items.length;
  const minutesDone = minutesForCompletions(items, defaultMinutes);
  const hoursDone = minutesDone / 60;
  const actual = goal.unit === 'hours' ? hoursDone : lessonsDone;
  const pct = goal.target > 0 ? actual / goal.target : 0;
  return { lessonsDone, minutesDone, hoursDone, actual, pct, tier: tierFor(pct) };
}

/** Monday 00:00 (local) of the ISO week containing `d`. Sunday belongs to the week that started the prior Monday. */
export function startOfIsoWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay(); // 0=Sun..6=Sat
  const diff = (dow + 6) % 7; // days since Monday
  x.setDate(x.getDate() - diff);
  return x;
}
