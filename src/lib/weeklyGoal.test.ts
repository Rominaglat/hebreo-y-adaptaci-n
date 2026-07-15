import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LESSON_MINUTES, minutesForCompletions, tierFor,
  lessonsForHours, computeWeeklyProgress, startOfIsoWeek,
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
});
