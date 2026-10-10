// Revenue / retention math for the subscriptions dashboard on /admin/users.
// Pure functions over public.student_subscriptions rows (synced from the
// customer-tracking sheet by the sync-subscriptions-sheet edge function).
//
// Dates on a row are 'YYYY-MM-DD' strings and are compared as strings; months
// are calendar months of `today` in local time.

export type SubStatus = 'active' | 'cancelled' | 'payment_failed' | 'unknown';

export interface SubscriptionRow {
  id: string;
  sheet_row: number;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status: SubStatus;
  status_raw: string | null;
  monthly_price: number | null;
  started_at: string | null;
  started_at_source: 'sheet' | 'platform_signup' | null;
  cancelled_at: string | null;
  cancelled_at_source: 'sheet' | 'access_revoked' | 'last_activity' | null;
  user_id: string | null;
  match_method: 'email' | 'phone' | null;
  match_note: string | null;
  synced_at: string;
}

export interface SubscriptionKpis {
  payingCount: number;
  /** Expected monthly revenue: sum of the paying students' monthly price. */
  mrr: number;
  /** Active in the sheet but no price — not counted as paying. */
  activeWithoutPrice: number;
  paymentFailedCount: number;
  cancelledCount: number;
  /** Cancelled ÷ at-risk over the last 3 complete months. null = no base to measure. */
  monthlyChurn: number | null;
  /** 1 / monthlyChurn. null while nobody has churned (or no base). */
  expectedLifetimeMonths: number | null;
  /** Plain average tenure of cancelled students that have both dates. */
  avgCancelledLifetimeMonths: number | null;
}

export interface RevenuePoint {
  /** YYYY-MM */
  month: string;
  /** Reconstructed revenue for past months and the current one. */
  actual: number | null;
  /** Projection; the current month carries the MRR so the two lines join. */
  forecast: number | null;
}

const CHURN_WINDOW_MONTHS = 3;
const DAYS_PER_MONTH = 30.4375;
const DAY_MS = 86_400_000;

const price = (r: SubscriptionRow): number => Number(r.monthly_price ?? 0) || 0;

export const isPaying = (r: SubscriptionRow): boolean => r.status === 'active' && price(r) > 0;

interface MonthSpan { key: string; start: string; end: string }

/** The calendar month `offset` months from today's month (0 = this month). */
function monthSpan(today: Date, offset: number): MonthSpan {
  const first = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const y = first.getFullYear();
  const m = first.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  const mm = String(m + 1).padStart(2, '0');
  return { key: `${y}-${mm}`, start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

/** A cancelled row with no cancel date cannot be placed in time. */
const isUndatedCancel = (r: SubscriptionRow) => r.status === 'cancelled' && !r.cancelled_at;

/** Still a customer on the first day of the month (unknown start = since before). */
const activeAtStartOf = (r: SubscriptionRow, m: MonthSpan): boolean =>
  !isUndatedCancel(r)
  && (!r.started_at || r.started_at < m.start)
  && (!r.cancelled_at || r.cancelled_at >= m.start);

/** A customer at any point during the month. */
const activeDuring = (r: SubscriptionRow, m: MonthSpan): boolean =>
  r.status !== 'unknown'
  && !isUndatedCancel(r)
  && (!r.started_at || r.started_at <= m.end)
  && (!r.cancelled_at || r.cancelled_at >= m.start);

const within = (day: string | null, m: MonthSpan): boolean => !!day && day >= m.start && day <= m.end;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function churnWindow(rows: SubscriptionRow[], today: Date): number | null {
  let churned = 0;
  let base = 0;
  for (let k = 1; k <= CHURN_WINDOW_MONTHS; k++) {
    const m = monthSpan(today, -k);
    for (const r of rows) {
      if (!activeAtStartOf(r, m)) continue;
      base++;
      if (r.status === 'cancelled' && within(r.cancelled_at, m)) churned++;
    }
  }
  return base === 0 ? null : churned / base;
}

export function computeKpis(rows: SubscriptionRow[], today: Date): SubscriptionKpis {
  const paying = rows.filter(isPaying);
  const monthlyChurn = churnWindow(rows, today);

  const tenures = rows
    .filter((r) => r.status === 'cancelled' && r.started_at && r.cancelled_at)
    .map((r) => (Date.parse(r.cancelled_at!) - Date.parse(r.started_at!)) / DAY_MS / DAYS_PER_MONTH)
    .filter((months) => Number.isFinite(months) && months >= 0);

  return {
    payingCount: paying.length,
    mrr: sum(paying.map(price)),
    activeWithoutPrice: rows.filter((r) => r.status === 'active' && r.monthly_price === null).length,
    paymentFailedCount: rows.filter((r) => r.status === 'payment_failed').length,
    cancelledCount: rows.filter((r) => r.status === 'cancelled').length,
    monthlyChurn,
    expectedLifetimeMonths: monthlyChurn ? 1 / monthlyChurn : null,
    avgCancelledLifetimeMonths: tenures.length ? sum(tenures) / tenures.length : null,
  };
}

/**
 * Past `back` months + the current month, rebuilt from start / cancel dates,
 * then `forward` months projected as
 *   mrr(n) = mrr(n−1) × (1 − churn) + average new monthly revenue
 * where the new-revenue average is over the last 3 complete months.
 */
export function revenueSeries(
  rows: SubscriptionRow[],
  today: Date,
  { back = 6, forward = 6 }: { back?: number; forward?: number } = {},
): RevenuePoint[] {
  const priced = rows.filter((r) => price(r) > 0);
  const { mrr, monthlyChurn } = computeKpis(rows, today);
  const churn = monthlyChurn ?? 0;

  const recentNew = Array.from({ length: CHURN_WINDOW_MONTHS }, (_, i) => {
    const m = monthSpan(today, -(i + 1));
    return sum(priced.filter((r) => within(r.started_at, m)).map(price));
  });
  const avgNewMrr = sum(recentNew) / CHURN_WINDOW_MONTHS;

  const points: RevenuePoint[] = [];
  for (let offset = -back; offset <= 0; offset++) {
    const m = monthSpan(today, offset);
    points.push({
      month: m.key,
      actual: Math.round(sum(priced.filter((r) => activeDuring(r, m)).map(price))),
      forecast: offset === 0 ? Math.round(mrr) : null,
    });
  }

  let projected = mrr;
  for (let offset = 1; offset <= forward; offset++) {
    projected = projected * (1 - churn) + avgNewMrr;
    points.push({ month: monthSpan(today, offset).key, actual: null, forecast: Math.round(projected) });
  }
  return points;
}

const STATUS_RANK: Record<SubStatus, number> = { active: 0, payment_failed: 1, cancelled: 2, unknown: 3 };

/**
 * One row per portal student. A student listed twice in the sheet (e.g. left
 * and came back) is represented by the active row, else the latest start.
 */
export function pickPerUser(rows: SubscriptionRow[]): Map<string, SubscriptionRow> {
  const out = new Map<string, SubscriptionRow>();
  for (const r of rows) {
    if (!r.user_id) continue;
    const cur = out.get(r.user_id);
    if (!cur || isBetter(r, cur)) out.set(r.user_id, r);
  }
  return out;
}

function isBetter(a: SubscriptionRow, b: SubscriptionRow): boolean {
  if (STATUS_RANK[a.status] !== STATUS_RANK[b.status]) return STATUS_RANK[a.status] < STATUS_RANK[b.status];
  const sa = a.started_at ?? '';
  const sb = b.started_at ?? '';
  if (sa !== sb) return sa > sb;
  return a.sheet_row > b.sheet_row;
}

const NUMBER_LOCALE: Record<string, string> = { he: 'he-IL', en: 'en-US', es: 'es' };

/** Whole shekels, in the reader's language ('₪10,420'). */
export function formatIls(amount: number, language: string, opts: { compact?: boolean } = {}): string {
  return new Intl.NumberFormat(NUMBER_LOCALE[language] ?? 'he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: opts.compact ? 1 : 0,
    notation: opts.compact ? 'compact' : 'standard',
  }).format(amount);
}
