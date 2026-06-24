import { describe, it, expect } from 'vitest';
import {
  isTimeLimitEligible,
  partitionByTimeLimitEligibility,
  buildAccessLimitBody,
} from './accessLimit';

describe('isTimeLimitEligible', () => {
  it('allows students', () => {
    expect(isTimeLimitEligible('student')).toBe(true);
  });

  it('allows leads', () => {
    expect(isTimeLimitEligible('lead')).toBe(true);
  });

  it('rejects admins, instructors and super_admins', () => {
    expect(isTimeLimitEligible('admin')).toBe(false);
    expect(isTimeLimitEligible('instructor')).toBe(false);
    expect(isTimeLimitEligible('super_admin')).toBe(false);
  });
});

describe('partitionByTimeLimitEligibility', () => {
  it('splits selected users into eligible and skipped, preserving order', () => {
    const users = [
      { id: 'a', role: 'student' },
      { id: 'b', role: 'admin' },
      { id: 'c', role: 'lead' },
      { id: 'd', role: 'instructor' },
    ];
    const { eligible, skipped } = partitionByTimeLimitEligibility(users);
    expect(eligible.map((u) => u.id)).toEqual(['a', 'c']);
    expect(skipped.map((u) => u.id)).toEqual(['b', 'd']);
  });

  it('returns empty groups for an empty selection', () => {
    const { eligible, skipped } = partitionByTimeLimitEligibility([]);
    expect(eligible).toEqual([]);
    expect(skipped).toEqual([]);
  });
});

describe('buildAccessLimitBody — hours mode', () => {
  it('builds an hours body for a positive integer', () => {
    const r = buildAccessLimitBody({ mode: 'hours', hours: '24' });
    expect(r).toEqual({ ok: true, body: { action: 'set_access_limit', hours: 24 } });
  });

  it('accepts fractional positive hours', () => {
    const r = buildAccessLimitBody({ mode: 'hours', hours: '1.5' });
    expect(r.ok).toBe(true);
    expect(r.ok && r.body).toEqual({ action: 'set_access_limit', hours: 1.5 });
  });

  it('rejects zero, negative, empty and non-numeric hours', () => {
    for (const hours of ['0', '-5', '', 'abc']) {
      const r = buildAccessLimitBody({ mode: 'hours', hours });
      expect(r).toEqual({ ok: false, code: 'invalid_hours' });
    }
  });
});

describe('buildAccessLimitBody — date mode', () => {
  const now = Date.UTC(2026, 5, 23, 12, 0, 0); // 2026-06-23T12:00:00Z

  it('builds an expiresAt body for a future date (as ISO)', () => {
    const future = new Date(now + 3 * 3600_000); // +3h
    const r = buildAccessLimitBody({ mode: 'date', date: future.toISOString() }, now);
    expect(r).toEqual({
      ok: true,
      body: { action: 'set_access_limit', expiresAt: future.toISOString() },
    });
  });

  it('rejects an empty date', () => {
    const r = buildAccessLimitBody({ mode: 'date', date: '' }, now);
    expect(r).toEqual({ ok: false, code: 'invalid_date' });
  });

  it('rejects a past date', () => {
    const past = new Date(now - 3600_000).toISOString();
    const r = buildAccessLimitBody({ mode: 'date', date: past }, now);
    expect(r).toEqual({ ok: false, code: 'invalid_date' });
  });

  it('rejects an unparseable date', () => {
    const r = buildAccessLimitBody({ mode: 'date', date: 'not-a-date' }, now);
    expect(r).toEqual({ ok: false, code: 'invalid_date' });
  });
});

describe('buildAccessLimitBody — clear mode', () => {
  it('builds a clear body', () => {
    const r = buildAccessLimitBody({ mode: 'clear' });
    expect(r).toEqual({ ok: true, body: { action: 'set_access_limit', clear: true } });
  });
});
