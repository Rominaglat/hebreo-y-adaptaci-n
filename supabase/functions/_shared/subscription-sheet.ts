// Pure logic behind sync-subscriptions-sheet: read the "תלמידים" tab of the
// customer-tracking sheet, tie each row to a portal profile, and fill the date
// gaps the sheet leaves. No I/O here — the edge function fetches, this decides.
//
// The sheet is hand-maintained, so every parser below is defensive: a junk
// cell becomes "unknown", never an exception. The one exception is a missing
// header row, which means the sheet was restructured — syncing anyway would
// replace good data with garbage, so that fails loudly instead.

import { isMatchableInput, matchPhone } from './phone-match.ts';

export type SubStatus = 'active' | 'cancelled' | 'payment_failed' | 'unknown';

export interface SheetRow {
  /** 1-based row number in the sheet, for tracing a figure back to its cell. */
  sheetRow: number;
  fullName: string | null;
  /** Trimmed and lower-cased. */
  email: string | null;
  phone: string | null;
  status: SubStatus;
  statusRaw: string | null;
  /** Monthly price in ILS. null = cell empty; 0 is a real (free) price. */
  monthlyPrice: number | null;
  /** YYYY-MM-DD */
  startedAt: string | null;
  /** YYYY-MM-DD */
  cancelledAt: string | null;
}

export class HeaderNotFoundError extends Error {
  constructor() {
    super('Header row (טלפון + מייל) not found in the first rows of the sheet');
    this.name = 'HeaderNotFoundError';
  }
}

/** The Apps Script bridge (scripts/sheet-bridge/Code.gs) did not hand over the tab. */
export class BridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeError';
  }
}

/**
 * The bridge answers {ok: true, values} or {ok: false, error}. Anything else —
 * typically Google's HTML sign-in or error page when the web app is not
 * deployed with access "Anyone" — is a BridgeError, never an empty sheet.
 */
export function parseBridgeResponse(status: number, text: string): string[][] {
  let body: { ok?: boolean; values?: unknown; error?: string };
  try {
    body = JSON.parse(text);
  } catch {
    throw new BridgeError(`bridge answered HTTP ${status} with non-JSON — is the web app deployed with access "Anyone"?`);
  }
  if (!body?.ok) throw new BridgeError(`bridge refused: ${body?.error ?? 'no reason given'}`);
  if (!Array.isArray(body.values)) throw new BridgeError('bridge answered ok without values');
  return body.values as string[][];
}

// Header texts, matched after trimming. The price column is titled
// "שווי חיי לקוח" in the live sheet but holds the MONTHLY price (₪244 / ₪208).
const HEADERS = {
  name: ['שם', 'שם מלא', 'name'],
  phone: ['טלפון', 'phone'],
  email: ['מייל', 'אימייל', 'email'],
  status: ['סטטוס', 'status'],
  startedAt: ['תאריך הצטרפות'],
  cancelledAt: ['תאריך ביטול'],
  price: ['שווי חיי לקוח', 'מחיר', 'שווי מנוי', 'מחיר חודשי'],
} as const;

const HEADER_SEARCH_ROWS = 10;

const STATUS_MAP: Record<string, SubStatus> = {
  'פעיל': 'active',
  'בוטל': 'cancelled',
  'תשלום לא עבר': 'payment_failed',
};

const cellText = (raw: unknown): string => (raw === null || raw === undefined ? '' : String(raw).trim());

export function mapStatus(raw: unknown): SubStatus {
  return STATUS_MAP[cellText(raw)] ?? 'unknown';
}

/** '₪1,220.00' → 1220, '244' → 244, '' / 'pay box' → null. */
export function parsePrice(raw: unknown): number | null {
  const cleaned = cellText(raw).replace(/[^\d.,]/g, '').replace(/,/g, '');
  if (!/\d/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Day-first like the sheet (13-07-2026, 05/10/2026, 1.9.2026), or ISO. Invalid → null. */
export function parseSheetDate(raw: unknown): string | null {
  const s = cellText(raw);
  let y: number, m: number, d: number;
  const dayFirst = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dayFirst) [d, m, y] = [Number(dayFirst[1]), Number(dayFirst[2]), Number(dayFirst[3])];
  else if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else return null;

  // Round-trip through Date to reject 31-02 and friends.
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

function findColumn(header: string[], names: readonly string[]): number {
  return header.findIndex((h) => names.includes(cellText(h)));
}

/**
 * Rows → SheetRow[]. The header is located by its texts because the live tab
 * has a student in row 1 ABOVE the header in row 2; any row other than the
 * header that carries an email or a phone is a student, wherever it sits.
 */
export function parseSheet(values: string[][]): SheetRow[] {
  const headerIdx = values
    .slice(0, HEADER_SEARCH_ROWS)
    .findIndex((r) => findColumn(r, HEADERS.phone) >= 0 && findColumn(r, HEADERS.email) >= 0);
  if (headerIdx < 0) throw new HeaderNotFoundError();

  const header = values[headerIdx];
  const col = {
    phone: findColumn(header, HEADERS.phone),
    email: findColumn(header, HEADERS.email),
    status: findColumn(header, HEADERS.status),
    startedAt: findColumn(header, HEADERS.startedAt),
    cancelledAt: findColumn(header, HEADERS.cancelledAt),
    price: findColumn(header, HEADERS.price),
  };
  // Column A carries the names but has no title in the live sheet.
  const nameCol = Math.max(findColumn(header, HEADERS.name), 0);
  const at = (r: string[], i: number) => (i < 0 ? '' : cellText(r[i]));

  const rows: SheetRow[] = [];
  values.forEach((r, i) => {
    if (i === headerIdx) return;
    const email = at(r, col.email).toLowerCase() || null;
    const phone = at(r, col.phone) || null;
    if (!email && !phone) return;
    const statusRaw = at(r, col.status) || null;
    rows.push({
      sheetRow: i + 1,
      fullName: at(r, nameCol) || null,
      email,
      phone,
      status: mapStatus(statusRaw),
      statusRaw,
      monthlyPrice: parsePrice(at(r, col.price)),
      startedAt: parseSheetDate(at(r, col.startedAt)),
      cancelledAt: parseSheetDate(at(r, col.cancelledAt)),
    });
  });
  return rows;
}

export interface ProfileLite {
  id: string;
  email: string | null;
  phone: string | null;
  join_date: string | null;
  /** profiles.deleted_at */
  deletedAt: string | null;
}

export interface RowMatch {
  userId: string | null;
  method: 'email' | 'phone' | null;
  /** Why an unmatched row is unmatched, when we know. */
  note: 'ambiguous_email' | 'ambiguous_phone' | 'deleted_account' | null;
}

/**
 * Email first (exact, case-insensitive, live profiles only), then phone via
 * the shared suffix matcher. Ambiguity is terminal — same rule as
 * users.inactivityByPhone: crediting the wrong student's subscription is worse
 * than showing the row as unmatched.
 */
export function matchRow(row: SheetRow, profiles: readonly ProfileLite[]): RowMatch {
  let deletedHit = false;

  if (row.email) {
    const hits = profiles.filter((p) => cellText(p.email).toLowerCase() === row.email);
    const live = hits.filter((p) => !p.deletedAt);
    if (live.length === 1) return { userId: live[0].id, method: 'email', note: null };
    if (live.length > 1) return { userId: null, method: null, note: 'ambiguous_email' };
    deletedHit = hits.length > 0;
  }

  if (row.phone && isMatchableInput(row.phone)) {
    const res = matchPhone(row.phone, profiles);
    if (res.status === 'matched') return { userId: res.matches[0].id, method: 'phone', note: null };
    if (res.status === 'ambiguous') return { userId: null, method: null, note: 'ambiguous_phone' };
    if (res.status === 'matched_deleted') deletedHit = true;
  }

  return { userId: null, method: null, note: deletedHit ? 'deleted_account' : null };
}

/**
 * student_activity was created and backfilled at this instant; a ping at or
 * before it was reconstructed by 20260823120000_lifecycle_backfill_activity,
 * not observed (47 rows carry exactly this value). Kept in step with
 * external-api's users.inactivityByPhone.
 */
export const ACTIVITY_TRACKING_SINCE = '2026-08-23T10:14:23.422Z';

export interface ActivitySignals {
  /** profiles.join_date */
  joinDate?: string | null;
  /** access_limits.revoked_at */
  revokedAt?: string | null;
  /** student_activity.last_active_at */
  activityPingAt?: string | null;
  /** latest lesson_completions.completed_at */
  lastLessonAt?: string | null;
  /** latest user_activities.created_at, password_reset excluded (admin-written) */
  lastAuthEventAt?: string | null;
  /** auth.users.last_sign_in_at */
  lastSignInAt?: string | null;
}

export interface EstimatedDates {
  startedAt: string | null;
  startedAtSource: 'sheet' | 'platform_signup' | null;
  cancelledAt: string | null;
  cancelledAtSource: 'sheet' | 'access_revoked' | 'last_activity' | null;
}

const dayOf = (ts: string | null | undefined): string | null => {
  if (!ts) return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
};

/**
 * Fill the dates the sheet leaves empty. The sheet always wins; estimates
 * only fill gaps and carry their source so the UI can mark them.
 * Only CANCELLED rows get a cancel date — an active student has none.
 */
export function estimateDates(row: SheetRow, s: ActivitySignals): EstimatedDates {
  let startedAt = row.startedAt;
  let startedAtSource: EstimatedDates['startedAtSource'] = startedAt ? 'sheet' : null;
  if (!startedAt) {
    startedAt = dayOf(s.joinDate);
    startedAtSource = startedAt ? 'platform_signup' : null;
  }

  if (row.status !== 'cancelled') {
    return { startedAt, startedAtSource, cancelledAt: null, cancelledAtSource: null };
  }
  if (row.cancelledAt) {
    return { startedAt, startedAtSource, cancelledAt: row.cancelledAt, cancelledAtSource: 'sheet' };
  }

  const trackingSinceMs = Date.parse(ACTIVITY_TRACKING_SINCE);
  const ping = s.activityPingAt && Date.parse(s.activityPingAt) > trackingSinceMs ? s.activityPingAt : null;
  const activityMs = [ping, s.lastLessonAt, s.lastAuthEventAt, s.lastSignInAt]
    .map((ts) => (ts ? Date.parse(ts) : NaN))
    .filter(Number.isFinite);
  const lastActivity = activityMs.length ? new Date(Math.max(...activityMs)).toISOString() : null;

  // A cancel date before the start is evidence of bad data, not of a cancel.
  const ladder: Array<[string | null, EstimatedDates['cancelledAtSource']]> = [
    [dayOf(s.revokedAt), 'access_revoked'],
    [dayOf(lastActivity), 'last_activity'],
  ];
  for (const [day, source] of ladder) {
    if (day && (!startedAt || day >= startedAt)) {
      return { startedAt, startedAtSource, cancelledAt: day, cancelledAtSource: source };
    }
  }
  return { startedAt, startedAtSource, cancelledAt: null, cancelledAtSource: null };
}
