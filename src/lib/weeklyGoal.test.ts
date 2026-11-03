import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LESSON_MINUTES, minutesForCompletions, tierFor,
  lessonsForHours, computeWeeklyProgress, startOfIsoWeek, formatMinutes,
} from './weeklyGoal';
import * as client from './weeklyGoal';
import * as server from '../../supabase/functions/_shared/study-time';

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
    expect(p.actual).toBe(7);
    expect(p.pct).toBeCloseTo(0.7);
    expect(p.tier).toBe('close');
  });

  it('computes progress for a lessons goal', () => {
    const items = Array.from({ length: 5 }, () => ({ durationMinutes: null }));
    const p = computeWeeklyProgress(items, { unit: 'lessons', target: 4 });
    expect(p.actual).toBe(5);
    expect(p.tier).toBe('exceeded'); // 5/4 = 1.25
  });

  it('is safe when nothing was completed', () => {
    const p = computeWeeklyProgress([], { unit: 'hours', target: 10 });
    expect(p.pct).toBe(0);
    expect(p.tier).toBe('inactive');
  });

  it('startOfIsoWeek returns Monday 00:00 for any weekday', () => {
    const wed = new Date(2026, 6, 15, 13, 30); // Wed 2026-07-15
    const mon = startOfIsoWeek(wed);
    expect(mon.getDay()).toBe(1);
    expect(mon.getDate()).toBe(13);
    expect(mon.getHours()).toBe(0);
  });

  it('startOfIsoWeek treats Sunday as end of the ISO week', () => {
    const sun = new Date(2026, 6, 19, 9, 0); // Sunday
    expect(startOfIsoWeek(sun).getDate()).toBe(13);
  });

  it('formats minutes as hours and minutes', () => {
    expect(formatMinutes(45, 'h', 'min')).toBe('45 min');
    expect(formatMinutes(80, 'h', 'min')).toBe('1 h 20 min');
    expect(formatMinutes(120, 'h', 'min')).toBe('2 h');
    expect(formatMinutes(0, 'h', 'min')).toBe('0 min');
  });

  it('counts watch time toward an hours goal, but not toward a lessons goal', () => {
    const items = [{ lessonId: 'a', durationMinutes: 30 }];
    const watched = [{ lessonId: 'a', seconds: 90 * 60 }]; // watched it three times
    const hours = computeWeeklyProgress(items, { unit: 'hours', target: 2 }, 30, watched);
    expect(hours.minutesDone).toBe(90);
    expect(hours.hoursDone).toBe(1.5);
    expect(hours.tier).toBe('close'); // completion alone would be 0.5 h → behind
    const lessons = computeWeeklyProgress(items, { unit: 'lessons', target: 1 }, 30, watched);
    expect(lessons.actual).toBe(1);
    expect(lessons.watchMinutes).toBe(90);
  });
});

// The weekly email job mirrors the client calculation; both must agree.
describe.each([
  ['client', client],
  ['server', server],
])('study time (%s)', (_name, impl) => {
  it('credits a rewatch beyond the lesson length', () => {
    expect(impl.creditedMinutes(
      [{ lessonId: 'a', durationMinutes: 30 }],
      [{ lessonId: 'a', seconds: 90 * 60 }],
      30,
    )).toBe(90);
  });

  it('never credits a completed lesson less than its length', () => {
    expect(impl.creditedMinutes(
      [{ lessonId: 'a', durationMinutes: 30 }],
      [{ lessonId: 'a', seconds: 5 * 60 }],
      30,
    )).toBe(30);
  });

  it('credits time on a lesson that was not completed this week', () => {
    expect(impl.creditedMinutes([], [{ lessonId: 'old', seconds: 20 * 60 }], 30)).toBe(20);
  });

  it('adds up a lesson watched across several days', () => {
    expect(impl.creditedMinutes(
      [{ lessonId: 'a', durationMinutes: null }],
      [{ lessonId: 'a', seconds: 25 * 60 }, { lessonId: 'a', seconds: 25 * 60 }],
      30,
    )).toBe(50);
  });

  it('falls back to the default length for completions with no watch time', () => {
    expect(impl.creditedMinutes(
      [{ lessonId: 'a', durationMinutes: null }, { lessonId: 'b', durationMinutes: 12 }],
      [],
      30,
    )).toBe(42);
  });

  it('rounds to whole minutes', () => {
    expect(impl.creditedMinutes([], [{ lessonId: 'a', seconds: 100 }], 30)).toBe(2);
  });

  it('counts a review only for a lesson finished before this week and watched for a minute', () => {
    const watched = [
      { lessonId: 'old', seconds: 600 },
      { lessonId: 'old', seconds: 30 }, // same lesson, another day: still one review
      { lessonId: 'brief', seconds: 59 },
      { lessonId: 'new', seconds: 900 },
    ];
    expect(impl.countReviewedLessons(watched, new Set(['old', 'brief']))).toBe(1);
  });
});
