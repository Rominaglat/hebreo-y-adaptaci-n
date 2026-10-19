import { describe, it, expect, vi } from 'vitest';
import { planVideoEnd, unlockedAfterCompleting, persistWithAuthRetry, isAuthFailure } from './videoCompletion';
import type { LessonGateInput } from './lessonGating';

describe('planVideoEnd', () => {
  it('records the lesson when the video ends even with auto-advance OFF', () => {
    expect(planVideoEnd({ alreadyCompleted: false, autoAdvance: false, hasNext: true }))
      .toEqual({ record: true, advance: false });
  });
  it('records and moves on with auto-advance ON', () => {
    expect(planVideoEnd({ alreadyCompleted: false, autoAdvance: true, hasNext: true }))
      .toEqual({ record: true, advance: true });
  });
  it('does not re-record a lesson already completed', () => {
    expect(planVideoEnd({ alreadyCompleted: true, autoAdvance: true, hasNext: true }))
      .toEqual({ record: false, advance: true });
  });
  it('has nowhere to advance at the last lesson', () => {
    expect(planVideoEnd({ alreadyCompleted: false, autoAdvance: true, hasNext: false }))
      .toEqual({ record: true, advance: false });
  });
});

describe('unlockedAfterCompleting', () => {
  const lesson = (id: string, order: number, done = false) => ({ id, title: id, order_index: order, is_completed: done });
  const input = (): LessonGateInput => ({
    modules: [{ id: 'm1', order_index: 0, lessons: [lesson('intro', 0, true), lesson('paal1', 1), lesson('tabla', 2), lesson('paal2', 3)] }],
    lessonsInOrder: true,
    courseUnlocked: true,
    isStaff: false,
  });

  it('opens the next lesson once the current one counts as completed', () => {
    // At the moment the video ends, the page's lock map still has "tabla" locked.
    expect(unlockedAfterCompleting(input(), 'paal1', 'tabla')).toBe(true);
  });
  it('does not open a lesson further down the line', () => {
    expect(unlockedAfterCompleting(input(), 'paal1', 'paal2')).toBe(false);
  });
  it('in a course without a required order, nothing is gated', () => {
    expect(unlockedAfterCompleting({ ...input(), lessonsInOrder: false }, 'paal1', 'paal2')).toBe(true);
  });
});

describe('isAuthFailure', () => {
  it('recognises an expired or missing session', () => {
    expect(isAuthFailure({ code: 'PGRST301', message: 'JWT expired' })).toBe(true);
    expect(isAuthFailure({ message: 'JWT expired' })).toBe(true);
    expect(isAuthFailure({ status: 401 })).toBe(true);
    // A write sent without a session reaches RLS as anon and is refused there.
    expect(isAuthFailure({ code: '42501', message: 'new row violates row-level security policy' })).toBe(true);
  });
  it('leaves other failures alone', () => {
    expect(isAuthFailure({ code: '23503', message: 'foreign key violation' })).toBe(false);
    expect(isAuthFailure(null)).toBe(false);
  });
});

describe('persistWithAuthRetry', () => {
  it('writes once when the first attempt succeeds', async () => {
    const write = vi.fn().mockResolvedValue({ error: null });
    const refresh = vi.fn();
    await expect(persistWithAuthRetry(write, refresh)).resolves.toEqual({ ok: true, error: null });
    expect(write).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes the session and retries once after an auth failure', async () => {
    const write = vi.fn()
      .mockResolvedValueOnce({ error: { code: 'PGRST301', message: 'JWT expired' } })
      .mockResolvedValueOnce({ error: null });
    const refresh = vi.fn().mockResolvedValue({});
    await expect(persistWithAuthRetry(write, refresh)).resolves.toEqual({ ok: true, error: null });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('gives up after one retry', async () => {
    const authError = { code: '42501', message: 'new row violates row-level security policy' };
    const write = vi.fn().mockResolvedValue({ error: authError });
    const refresh = vi.fn().mockResolvedValue({});
    await expect(persistWithAuthRetry(write, refresh)).resolves.toEqual({ ok: false, error: authError });
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('does not retry a failure that a new session cannot fix', async () => {
    const write = vi.fn().mockResolvedValue({ error: { code: '23503', message: 'fk' } });
    const refresh = vi.fn();
    const result = await persistWithAuthRetry(write, refresh);
    expect(result.ok).toBe(false);
    expect(write).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reports failure, not a crash, when the refresh itself throws', async () => {
    const write = vi.fn().mockResolvedValue({ error: { status: 401, message: 'unauthorized' } });
    const refresh = vi.fn().mockRejectedValue(new Error('offline'));
    const result = await persistWithAuthRetry(write, refresh);
    expect(result.ok).toBe(false);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
