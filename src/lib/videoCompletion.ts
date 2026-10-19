// What happens when a lesson video reaches its end (CourseDetail).
//
// Two bugs left students stuck behind a lesson they had watched to the end:
//   1. The completion was only written when the "auto-advance" switch was on —
//      a student who had switched it off finished the video and nothing was
//      recorded, so the next lesson stayed locked.
//   2. The write's error was ignored and the lesson was flipped to "completed"
//      on screen anyway. A rejected write (an expired session after the laptop
//      slept, typically) looked like success until the next reload re-locked
//      everything.
// Watching to the end now always records the lesson, through a verified write
// that retries once after refreshing the session; the switch only decides
// whether to move on.

import { computeLessonLocks, type GatingLesson, type LessonGateInput } from './lessonGating';

export function planVideoEnd(p: { alreadyCompleted: boolean; autoAdvance: boolean; hasNext: boolean }): {
  record: boolean;
  advance: boolean;
} {
  return { record: !p.alreadyCompleted, advance: p.autoAdvance && p.hasNext };
}

/**
 * Is `nextId` open once `completedId` counts as completed? The page's lock map
 * was computed before the completion landed, so it still has the next lesson
 * locked at the moment the video ends.
 */
export function unlockedAfterCompleting<L extends GatingLesson>(
  input: LessonGateInput<L>,
  completedId: string,
  nextId: string,
): boolean {
  const modules = input.modules.map((m) => ({
    ...m,
    lessons: m.lessons.map((l) => (l.id === completedId ? { ...l, is_completed: true } : l)),
  }));
  return !computeLessonLocks({ ...input, modules }).has(nextId);
}

export interface WriteError { code?: string; message?: string; status?: number }

/**
 * Failures a fresh session can fix: an expired / invalid JWT, or a write that
 * went out without one and was refused by RLS as anon (42501).
 */
export function isAuthFailure(error: WriteError | null | undefined): boolean {
  if (!error) return false;
  return error.status === 401
    || error.code === 'PGRST301'
    || error.code === 'PGRST302'
    || error.code === '42501'
    || /jwt/i.test(error.message ?? '');
}

/** Run a write; after an auth failure, refresh the session and try exactly once more. */
export async function persistWithAuthRetry<E extends WriteError>(
  write: () => PromiseLike<{ error: E | null }>,
  refreshSession: () => PromiseLike<unknown>,
): Promise<{ ok: boolean; error: E | null }> {
  const first = await write();
  if (!first.error) return { ok: true, error: null };
  if (!isAuthFailure(first.error)) return { ok: false, error: first.error };
  try {
    await refreshSession();
  } catch {
    return { ok: false, error: first.error };
  }
  const second = await write();
  return second.error ? { ok: false, error: second.error } : { ok: true, error: null };
}
