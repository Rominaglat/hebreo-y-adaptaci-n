import { describe, it, expect } from 'vitest';
import { onboardingWindow, dedupeKey, selectRecipients, ledgerKey, type LifecycleCandidate } from './lifecycle';

const NOW = new Date('2026-08-23T12:00:00.000Z');

describe('onboardingWindow', () => {
  it('holds the welcome email until 6h after signup', () => {
    expect(onboardingWindow('welcome_6h', NOW).createdBefore).toBe('2026-08-23T06:00:00.000Z');
  });

  it('caps the welcome email at 72h so a cron outage cannot blast stale signups', () => {
    expect(onboardingWindow('welcome_6h', NOW).createdAfter).toBe('2026-08-20T12:00:00.000Z');
  });

  it('holds the tips email until 48h after signup', () => {
    expect(onboardingWindow('tips_48h', NOW).createdBefore).toBe('2026-08-21T12:00:00.000Z');
  });

  it('caps the tips email at 7d', () => {
    expect(onboardingWindow('tips_48h', NOW).createdAfter).toBe('2026-08-16T12:00:00.000Z');
  });
});

describe('onboardingWindow guard', () => {
  it('refuses a kind that is not driven by signup time', () => {
    expect(() => onboardingWindow('inactive_7d', NOW)).toThrow(/not an onboarding email/);
  });
});

describe('dedupeKey', () => {
  it('is constant for onboarding emails so each user gets one, ever', () => {
    const a = { userId: 'u1', createdAt: '2026-08-23T09:00:00.000Z', lastActiveAt: null };
    const b = { userId: 'u1', createdAt: '2026-08-23T09:00:00.000Z', lastActiveAt: '2026-08-23T11:00:00.000Z' };
    expect(dedupeKey('welcome_6h', a)).toBe(dedupeKey('welcome_6h', b));
  });

  it('keys the inactivity email to the day activity stopped', () => {
    const user = { userId: 'u1', createdAt: '2026-07-01T00:00:00.000Z', lastActiveAt: '2026-08-10T18:30:00.000Z' };
    expect(dedupeKey('inactive_7d', user)).toBe('2026-08-10');
  });

  it('gives a returning student a fresh key, so a second absence mails again', () => {
    const gone = { userId: 'u1', createdAt: '2026-07-01T00:00:00.000Z', lastActiveAt: '2026-08-10T18:30:00.000Z' };
    const returnedThenGone = { ...gone, lastActiveAt: '2026-08-16T09:00:00.000Z' };
    expect(dedupeKey('inactive_7d', returnedThenGone)).not.toBe(dedupeKey('inactive_7d', gone));
  });

  it('derives the day in UTC, not from the raw offset text', () => {
    // 01:00+03:00 is still 22:00 UTC the previous day.
    const u = { userId: 'u1', createdAt: '2026-07-01T00:00:00.000Z', lastActiveAt: '2026-08-23T01:00:00+03:00' };
    expect(dedupeKey('inactive_7d', u)).toBe('2026-08-22');
  });

  it('falls back to signup date for students who have never been seen active', () => {
    const legacy = { userId: 'u1', createdAt: '2026-06-05T07:00:00.000Z', lastActiveAt: null };
    expect(dedupeKey('inactive_7d', legacy)).toBe('2026-06-05');
  });
});

const noneSent = new Set<string>();
// The portal went live long before lifecycle emails existed.
const START_AT = '2026-08-01T00:00:00.000Z';
const base = { now: NOW, startAt: START_AT, alreadySent: noneSent };
const student = (over: Partial<LifecycleCandidate> = {}): LifecycleCandidate => ({
  userId: 'u1', createdAt: '2026-08-23T03:00:00.000Z', lastActiveAt: null, emailsEnabled: true, ...over,
});
const ids = (r: ReturnType<typeof selectRecipients>) => r.map((x) => x.candidate.userId);

describe('selectRecipients — onboarding', () => {
  it('picks a student whose signup has aged past the delay', () => {
    expect(ids(selectRecipients('welcome_6h', [student()], base))).toEqual(['u1']);
  });

  it('leaves a student who signed up an hour ago for a later run', () => {
    const tooFresh = student({ createdAt: '2026-08-23T11:00:00.000Z' });
    expect(selectRecipients('welcome_6h', [tooFresh], base)).toEqual([]);
  });

  it('never mails students who existed before the feature shipped', () => {
    const legacy = student({ createdAt: '2026-07-15T09:00:00.000Z' });
    expect(selectRecipients('welcome_6h', [legacy], base)).toEqual([]);
    expect(selectRecipients('tips_48h', [legacy], base)).toEqual([]);
  });

  it('skips a signup older than the catch-up grace window', () => {
    const stale = student({ createdAt: '2026-08-18T12:00:00.000Z' }); // 5 days — past the 72h grace
    expect(selectRecipients('welcome_6h', [stale], base)).toEqual([]);
  });

  it('sends regardless of whether the student has already been active', () => {
    const engaged = student({ lastActiveAt: '2026-08-23T11:59:00.000Z' });
    expect(ids(selectRecipients('welcome_6h', [engaged], base))).toEqual(['u1']);
  });

  it('does not resend what the ledger already recorded', () => {
    const s = student();
    const sent = new Set([ledgerKey('u1', 'welcome_6h', dedupeKey('welcome_6h', s))]);
    expect(selectRecipients('welcome_6h', [s], { ...base, alreadySent: sent })).toEqual([]);
  });

  it('skips students who unsubscribed', () => {
    expect(selectRecipients('welcome_6h', [student({ emailsEnabled: false })], base)).toEqual([]);
  });
});

describe('selectRecipients — inactivity', () => {
  it('picks a student last seen more than 7 days ago', () => {
    const gone = student({ createdAt: '2026-06-01T00:00:00.000Z', lastActiveAt: '2026-08-14T10:00:00.000Z' });
    expect(ids(selectRecipients('inactive_7d', [gone], base))).toEqual(['u1']);
  });

  it('leaves alone a student seen within the week', () => {
    const active = student({ createdAt: '2026-06-01T00:00:00.000Z', lastActiveAt: '2026-08-20T10:00:00.000Z' });
    expect(selectRecipients('inactive_7d', [active], base)).toEqual([]);
  });

  it('applies to students who predate the feature, unlike the onboarding mails', () => {
    const legacy = student({ createdAt: '2026-07-15T09:00:00.000Z', lastActiveAt: null });
    expect(ids(selectRecipients('inactive_7d', [legacy], base))).toEqual(['u1']);
  });

  it('mails a second time once the student returns and lapses again', () => {
    const first = student({ createdAt: '2026-06-01T00:00:00.000Z', lastActiveAt: '2026-08-01T10:00:00.000Z' });
    const sent = new Set([ledgerKey('u1', 'inactive_7d', dedupeKey('inactive_7d', first))]);
    expect(selectRecipients('inactive_7d', [first], { ...base, alreadySent: sent })).toEqual([]);

    const lapsedAgain = { ...first, lastActiveAt: '2026-08-10T10:00:00.000Z' };
    expect(ids(selectRecipients('inactive_7d', [lapsedAgain], { ...base, alreadySent: sent }))).toEqual(['u1']);
  });
});

// PostgREST returns timestamptz as '2026-08-23T09:00:00.123456+00:00', while
// Date#toISOString produces '...Z'. Comparing those two as strings is wrong at
// the character level ('+' sorts before '.'), so every boundary below must be
// decided on the instant, not the text.
describe('selectRecipients — Postgres timestamp formats', () => {
  it('treats a +00:00 signup the same as the equivalent Z signup', () => {
    const pgStyle = student({ createdAt: '2026-08-23T03:00:00.123456+00:00' });
    const zStyle = student({ createdAt: '2026-08-23T03:00:00.123Z' });
    expect(ids(selectRecipients('welcome_6h', [pgStyle], base)))
      .toEqual(ids(selectRecipients('welcome_6h', [zStyle], base)));
  });

  it('still excludes a pre-launch signup when startAt comes back in Postgres form', () => {
    const legacy = student({ createdAt: '2026-07-15T09:00:00.000000+00:00' });
    const pgStart = { ...base, startAt: '2026-08-01T00:00:00.000000+00:00' };
    expect(selectRecipients('welcome_6h', [legacy], pgStart)).toEqual([]);
  });

  it('does not let a +00:00 signup slip past the launch guard', () => {
    // 09:00 on launch day. As raw text this sorts BEFORE '2026-08-01T00:00:00.000Z',
    // which would wrongly mark a post-launch signup as pre-launch.
    const justAfterLaunch = student({ createdAt: '2026-08-01T09:00:00+00:00' });
    const onLaunchDay = { ...base, now: new Date('2026-08-01T20:00:00.000Z') };
    expect(ids(selectRecipients('welcome_6h', [justAfterLaunch], onLaunchDay))).toEqual(['u1']);
  });

  it('honours a non-UTC offset instead of comparing the text', () => {
    // 09:00+03:00 IS 06:00Z — exactly the 6h boundary, so this student is due.
    // Compared as text, '09' sorts after '06' and they would be skipped.
    const tzOffset = student({ createdAt: '2026-08-23T09:00:00+03:00' });
    expect(ids(selectRecipients('welcome_6h', [tzOffset], base))).toEqual(['u1']);
  });

  it('does not count a launch-instant signup as pre-launch', () => {
    const atLaunch = student({ createdAt: '2026-08-01T00:00:00+00:00' });
    const launch = { ...base, startAt: '2026-08-01T00:00:00.000Z', now: new Date('2026-08-01T12:00:00.000Z') };
    expect(ids(selectRecipients('welcome_6h', [atLaunch], launch))).toEqual(['u1']);
  });
});
