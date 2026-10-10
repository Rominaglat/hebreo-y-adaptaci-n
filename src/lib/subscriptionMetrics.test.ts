import { describe, it, expect } from 'vitest';
import {
  isPaying,
  computeKpis,
  revenueSeries,
  pickPerUser,
  formatIls,
  type SubscriptionRow,
} from './subscriptionMetrics';

// "Today" for every test: 10 Oct 2026. The last three COMPLETE months are
// July, August and September.
const TODAY = new Date(2026, 9, 10);

let seq = 0;
const sub = (over: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  id: `r${++seq}`,
  sheet_row: seq,
  full_name: null,
  email: null,
  phone: null,
  status: 'active',
  status_raw: null,
  monthly_price: 244,
  started_at: '2026-06-15',
  started_at_source: 'sheet',
  cancelled_at: null,
  cancelled_at_source: null,
  user_id: null,
  match_method: null,
  match_note: null,
  synced_at: '2026-10-10T10:00:00Z',
  ...over,
});

const times = (n: number, over: Partial<SubscriptionRow>) => Array.from({ length: n }, () => sub(over));

describe('isPaying', () => {
  it('is an active row with a positive price', () => {
    expect(isPaying(sub())).toBe(true);
    expect(isPaying(sub({ monthly_price: null }))).toBe(false);
    expect(isPaying(sub({ monthly_price: 0 }))).toBe(false);
    expect(isPaying(sub({ status: 'cancelled' }))).toBe(false);
    expect(isPaying(sub({ status: 'payment_failed' }))).toBe(false);
  });
});

describe('computeKpis', () => {
  it('reproduces the sheet as measured on 2026-10-10', () => {
    const rows = [
      ...times(41, { monthly_price: 244 }),
      ...times(2, { monthly_price: 208 }),
      ...times(26, { monthly_price: null }),
      ...times(25, { status: 'cancelled', monthly_price: null }),
      sub({ status: 'payment_failed' }),
    ];
    const k = computeKpis(rows, TODAY);
    expect(k.payingCount).toBe(43);
    expect(k.mrr).toBe(10420);
    expect(k.activeWithoutPrice).toBe(26);
    expect(k.cancelledCount).toBe(25);
    expect(k.paymentFailedCount).toBe(1);
  });

  it('measures churn over the last three complete months only', () => {
    const rows = [
      ...times(8, { started_at: '2026-05-01' }),
      // One cancel inside the window (August)…
      sub({ status: 'cancelled', started_at: '2026-05-01', cancelled_at: '2026-08-20' }),
      // …one in the still-running month, which must not count…
      sub({ status: 'cancelled', started_at: '2026-05-01', cancelled_at: '2026-10-02' }),
      // …and one before the window, which is not in any base.
      sub({ status: 'cancelled', started_at: '2026-01-01', cancelled_at: '2026-05-20' }),
    ];
    const k = computeKpis(rows, TODAY);
    // Bases: Jul 10 (8 + Aug-cancel + Oct-cancel), Aug 10, Sep 9 → 29. Churned: 1.
    expect(k.monthlyChurn).toBeCloseTo(1 / 29, 6);
    expect(k.expectedLifetimeMonths).toBeCloseTo(29, 6);
  });

  it('treats a row with no start date as active since before the window', () => {
    const rows = [sub({ started_at: null }), sub({ status: 'cancelled', started_at: null, cancelled_at: '2026-09-05' })];
    const k = computeKpis(rows, TODAY);
    // Bases: Jul 2, Aug 2, Sep 2 → 6. Churned: 1 (September).
    expect(k.monthlyChurn).toBeCloseTo(1 / 6, 6);
  });

  it('leaves cancelled rows without a cancel date out of churn entirely', () => {
    const rows = [
      ...times(4, { started_at: '2026-05-01' }),
      ...times(10, { status: 'cancelled', started_at: '2026-05-01', cancelled_at: null }),
    ];
    const k = computeKpis(rows, TODAY);
    expect(k.monthlyChurn).toBe(0);
  });

  it('reports no lifetime instead of Infinity when nobody has churned', () => {
    const k = computeKpis(times(5, {}), TODAY);
    expect(k.monthlyChurn).toBe(0);
    expect(k.expectedLifetimeMonths).toBeNull();
  });

  it('copes with an empty table', () => {
    const k = computeKpis([], TODAY);
    expect(k).toMatchObject({
      payingCount: 0, mrr: 0, activeWithoutPrice: 0, monthlyChurn: null,
      expectedLifetimeMonths: null, avgCancelledLifetimeMonths: null,
    });
  });

  it('averages the actual tenure of cancelled students that have both dates', () => {
    const rows = [
      sub({ status: 'cancelled', started_at: '2026-06-01', cancelled_at: '2026-08-01' }), // 61 days
      sub({ status: 'cancelled', started_at: '2026-06-01', cancelled_at: '2026-10-01' }), // 122 days
      sub({ status: 'cancelled', started_at: null, cancelled_at: '2026-09-01' }), // ignored
    ];
    const k = computeKpis(rows, TODAY);
    expect(k.avgCancelledLifetimeMonths).toBeCloseTo((61 + 122) / 2 / 30.4375, 6);
  });
});

describe('revenueSeries', () => {
  it('covers 6 past months, the current month, and 6 forecast months', () => {
    const s = revenueSeries([], TODAY);
    expect(s.map((p) => p.month)).toEqual([
      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10',
      '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04',
    ]);
  });

  it('rebuilds past revenue from start and cancel dates', () => {
    const rows = [
      sub({ started_at: '2026-07-20', monthly_price: 244 }),
      sub({ status: 'cancelled', started_at: '2026-06-03', cancelled_at: '2026-08-10', monthly_price: 208 }),
      // Unknown start: counted from before the window.
      sub({ started_at: null, monthly_price: 100 }),
      // Cancelled with no date at all: left out of history.
      sub({ status: 'cancelled', started_at: '2026-06-01', cancelled_at: null, monthly_price: 500 }),
    ];
    const byMonth = Object.fromEntries(revenueSeries(rows, TODAY).map((p) => [p.month, p.actual]));
    expect(byMonth['2026-05']).toBe(100);
    expect(byMonth['2026-06']).toBe(308);
    expect(byMonth['2026-07']).toBe(552);
    expect(byMonth['2026-08']).toBe(552); // cancelled mid-August still paid August
    expect(byMonth['2026-09']).toBe(344);
    expect(byMonth['2026-10']).toBe(344);
  });

  it('forecasts from current MRR with churn and the recent average of new revenue', () => {
    const rows = [
      // 10 long-standing payers at 100, one of whom cancelled in August.
      ...times(9, { started_at: '2026-01-01', monthly_price: 100 }),
      sub({ status: 'cancelled', started_at: '2026-01-01', cancelled_at: '2026-08-15', monthly_price: 100 }),
      // New revenue: 300 started in September (Jul + Aug + Sep → 300 / 3 = 100 per month).
      sub({ started_at: '2026-09-10', monthly_price: 300 }),
    ];
    const s = revenueSeries(rows, TODAY);
    const k = computeKpis(rows, TODAY);
    const current = s.find((p) => p.month === '2026-10')!;
    expect(current.forecast).toBe(1200); // MRR, so the dashed line starts here
    const nov = s.find((p) => p.month === '2026-11')!;
    expect(nov.actual).toBeNull();
    expect(nov.forecast).toBe(Math.round(1200 * (1 - k.monthlyChurn!) + 100));
    expect(s.find((p) => p.month === '2026-09')!.forecast).toBeNull();
  });
});

describe('pickPerUser', () => {
  it('keeps one row per student, preferring the active one, then the latest start', () => {
    const rows = [
      sub({ user_id: 'u1', status: 'cancelled', started_at: '2026-09-01' }),
      sub({ user_id: 'u1', status: 'active', started_at: '2026-06-01', id: 'keep' }),
      sub({ user_id: 'u2', status: 'cancelled', started_at: '2026-06-01' }),
      sub({ user_id: 'u2', status: 'cancelled', started_at: '2026-08-01', id: 'latest' }),
      sub({ user_id: null }),
    ];
    const m = pickPerUser(rows);
    expect(m.size).toBe(2);
    expect(m.get('u1')!.id).toBe('keep');
    expect(m.get('u2')!.id).toBe('latest');
  });
});

describe('formatIls', () => {
  it('shows whole shekels with the shekel sign', () => {
    expect(formatIls(10420, 'en')).toBe('₪10,420');
    expect(formatIls(10420, 'he')).toContain('10,420');
    expect(formatIls(10420, 'he')).toContain('₪');
  });
  it('can abbreviate for chart axes', () => {
    expect(formatIls(10420, 'en', { compact: true })).toBe('₪10.4K');
  });
});
