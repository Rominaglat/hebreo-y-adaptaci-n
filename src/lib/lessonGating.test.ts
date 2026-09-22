import { describe, it, expect } from 'vitest';
import { computeLessonLocks, type GatingModule } from './lessonGating';

const lesson = (
  id: string,
  order_index: number,
  extra: Partial<{ is_completed: boolean; is_hidden: boolean }> = {},
) => ({
  id,
  title: id,
  order_index,
  is_completed: false,
  is_hidden: false,
  ...extra,
});

/** One module, lessons a→b→c, nothing done. */
const freshCourse: GatingModule[] = [
  { id: 'm1', order_index: 0, lessons: [lesson('a', 0), lesson('b', 1), lesson('c', 2)] },
];

const base = {
  modules: freshCourse,
  lessonsInOrder: true,
  courseUnlocked: true,
  isStaff: false,
};

describe('computeLessonLocks — sequential rule', () => {
  it('unlocks the first lesson and locks everything after it', () => {
    const locks = computeLessonLocks(base);
    expect(locks.has('a')).toBe(false);
    expect(locks.get('b')).toEqual({ reason: 'lesson', blockedBy: expect.objectContaining({ id: 'a' }) });
    expect(locks.get('c')).toEqual({ reason: 'lesson', blockedBy: expect.objectContaining({ id: 'a' }) });
  });

  it('names the actual blocking lesson, not just "the previous one"', () => {
    const modules: GatingModule[] = [
      { id: 'm1', order_index: 0, lessons: [lesson('a', 0, { is_completed: true }), lesson('b', 1), lesson('c', 2)] },
    ];
    const locks = computeLessonLocks({ ...base, modules });
    expect(locks.get('c')?.blockedBy?.id).toBe('b');
  });

  it('locks nothing in a non-sequential (open) course', () => {
    expect(computeLessonLocks({ ...base, lessonsInOrder: false }).size).toBe(0);
  });

  it('locks nothing for admins and instructors', () => {
    expect(computeLessonLocks({ ...base, isStaff: true, courseUnlocked: false }).size).toBe(0);
  });

  it('orders across modules by module order, then lesson order', () => {
    const modules: GatingModule[] = [
      { id: 'm2', order_index: 1, lessons: [lesson('c', 0)] },
      { id: 'm1', order_index: 0, lessons: [lesson('b', 1), lesson('a', 0)] },
    ];
    const locks = computeLessonLocks({ ...base, modules });
    expect(locks.has('a')).toBe(false);
    expect(locks.get('b')?.blockedBy?.id).toBe('a');
    expect(locks.get('c')?.blockedBy?.id).toBe('a');
  });
});

describe('computeLessonLocks — a finished lesson is never re-locked', () => {
  it('leaves an already-completed lesson open even when an earlier one is undone', () => {
    // The student watched everything, then un-marked lesson "a".
    const modules: GatingModule[] = [
      { id: 'm1', order_index: 0, lessons: [lesson('a', 0), lesson('b', 1, { is_completed: true }), lesson('c', 2, { is_completed: true })] },
    ];
    const locks = computeLessonLocks({ ...base, modules });
    expect(locks.has('b')).toBe(false);
    expect(locks.has('c')).toBe(false);
  });
});

describe('computeLessonLocks — hidden lessons never block', () => {
  it('does not let a hidden lesson gate the lessons after it', () => {
    const modules: GatingModule[] = [
      { id: 'm1', order_index: 0, lessons: [lesson('a', 0, { is_completed: true }), lesson('h', 1, { is_hidden: true }), lesson('c', 2)] },
    ];
    expect(computeLessonLocks({ ...base, modules }).has('c')).toBe(false);
  });
});

describe('computeLessonLocks — cross-course gate', () => {
  it('locks every lesson with reason "course" when the prerequisite is unfinished', () => {
    const locks = computeLessonLocks({ ...base, courseUnlocked: false });
    expect([...locks.values()].every((l) => l.reason === 'course')).toBe(true);
    expect(locks.size).toBe(3);
  });

  it('does not re-lock a course the student has already started', () => {
    // The gate opened for her once; a later catalog reorder must not shut it.
    const modules: GatingModule[] = [
      { id: 'm1', order_index: 0, lessons: [lesson('a', 0, { is_completed: true }), lesson('b', 1), lesson('c', 2)] },
    ];
    const locks = computeLessonLocks({ ...base, modules, courseUnlocked: false });
    expect([...locks.values()].some((l) => l.reason === 'course')).toBe(false);
  });

  it('leaves a fully completed course entirely open even when gated', () => {
    const modules: GatingModule[] = [
      {
        id: 'm1',
        order_index: 0,
        lessons: [
          lesson('a', 0, { is_completed: true }),
          lesson('b', 1, { is_completed: true }),
          lesson('c', 2, { is_completed: true }),
        ],
      },
    ];
    expect(computeLessonLocks({ ...base, modules, courseUnlocked: false }).size).toBe(0);
  });
});
