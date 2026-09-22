// The single source of truth for "why is this lesson locked?" on the client.
//
// This mirrors is_lesson_unlocked() / is_course_unlocked() in the database
// (see 20260922100000_gate_never_relocks_finished_work.sql). The SQL remains
// the enforcement point — completion writes are checked against it by RLS —
// and this module exists so the UI can say the same thing without a round
// trip, and say it in the same words every time. It used to be two inline
// copies in CourseDetail that drifted apart.
//
// Three rules, in order of precedence:
//
//   1. A lesson the student has already completed is NEVER locked. Content
//      you have consumed can't be taken away from you — not by a catalog
//      reorder, not by a new lesson appearing in an earlier course, not by
//      un-marking something. Re-watching is always allowed.
//   2. Hidden lessons never block. Students can't see them, so they can't
//      complete them; letting one gate the rest is an unsatisfiable lock.
//   3. The cross-course gate only applies to a course the student hasn't
//      started. Once they're inside, the gate has already opened for them.

export type GatingLesson = {
  id: string;
  title: string;
  order_index: number;
  is_completed: boolean;
  is_hidden?: boolean;
};

// Generic over the lesson shape so callers get their own richer Lesson type
// back in `blockedBy` (the page needs the full row to select the lesson).
export type GatingModule<L extends GatingLesson = GatingLesson> = {
  id: string;
  order_index: number;
  lessons: L[];
};

export type LessonLock<L extends GatingLesson = GatingLesson> =
  /** An earlier course in the chain isn't finished yet. */
  | { reason: 'course'; blockedBy?: undefined }
  /** An earlier lesson in THIS course isn't finished yet. */
  | { reason: 'lesson'; blockedBy: L };

export type LessonGateInput<L extends GatingLesson = GatingLesson> = {
  modules: GatingModule<L>[];
  /** course.lessons_in_order !== false — open courses gate nothing. */
  lessonsInOrder: boolean;
  /** The is_course_unlocked() verdict for this course and user. */
  courseUnlocked: boolean;
  isStaff: boolean;
};

/** Flatten to the order a student walks the course in: module order, then
 * lesson order within the module. */
export function orderLessons<L extends GatingLesson>(modules: GatingModule<L>[]): L[] {
  return [...modules]
    .sort((a, b) => a.order_index - b.order_index)
    .flatMap((m) => [...m.lessons].sort((a, b) => a.order_index - b.order_index));
}

/** True once the student has completed anything at all here — the proof that
 * the cross-course gate was open for them at some point. */
export function hasStartedCourse<L extends GatingLesson>(modules: GatingModule<L>[]): boolean {
  return modules.some((m) => m.lessons.some((l) => l.is_completed));
}

/** Locked lesson id → why. Absent from the map means unlocked. */
export function computeLessonLocks<L extends GatingLesson>(
  input: LessonGateInput<L>,
): Map<string, LessonLock<L>> {
  const locks = new Map<string, LessonLock<L>>();
  if (input.isStaff) return locks;

  const ordered = orderLessons(input.modules);

  // Rule 3: the cross-course gate closes a course only if it was never
  // entered. A student with progress here is past it for good.
  if (!input.courseUnlocked && !hasStartedCourse(input.modules)) {
    ordered.forEach((l) => locks.set(l.id, { reason: 'course' }));
    return locks;
  }

  if (!input.lessonsInOrder) return locks;

  // Sequential rule: the first unfinished, visible lesson is the frontier.
  // Everything past it is locked — except lessons already completed, which
  // rule 1 keeps open forever.
  let blocker: L | null = null;
  for (const lesson of ordered) {
    if (lesson.is_completed) continue;
    if (blocker) {
      locks.set(lesson.id, { reason: 'lesson', blockedBy: blocker });
    } else if (!lesson.is_hidden) {
      blocker = lesson;
    }
  }
  return locks;
}
