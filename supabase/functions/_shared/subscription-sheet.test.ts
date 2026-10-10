import { describe, it, expect } from 'vitest';
import {
  parseSheet,
  parsePrice,
  parseSheetDate,
  mapStatus,
  matchRow,
  estimateDates,
  HeaderNotFoundError,
  BridgeError,
  parseBridgeResponse,
  ACTIVITY_TRACKING_SINCE,
  type ProfileLite,
  type SheetRow,
} from './subscription-sheet.ts';

/** The header exactly as the live "תלמידים" tab spells it (col A has no title). */
const HEADER = ['', 'טלפון', 'מייל', 'סטטוס', 'הערות', 'תאריך הצטרפות', 'תאריך ביטול', 'שווי חיי לקוח'];

const row = (over: Partial<SheetRow> = {}): SheetRow => ({
  sheetRow: 3,
  fullName: 'Test',
  email: 'a@x.com',
  phone: '050-1234567',
  status: 'active',
  statusRaw: 'פעיל',
  monthlyPrice: 244,
  startedAt: null,
  cancelledAt: null,
  ...over,
});

const profile = (over: Partial<ProfileLite> = {}): ProfileLite => ({
  id: 'u1',
  email: 'a@x.com',
  phone: '050-1234567',
  join_date: '2026-07-01T09:00:00Z',
  deletedAt: null,
  ...over,
});

describe('parsePrice', () => {
  it('reads the shekel-formatted cells the sheet renders', () => {
    expect(parsePrice('₪244.00')).toBe(244);
    expect(parsePrice('₪ 208')).toBe(208);
    expect(parsePrice('₪1,220.00')).toBe(1220);
  });
  it('reads a bare number, and keeps an explicit zero', () => {
    expect(parsePrice('244')).toBe(244);
    expect(parsePrice('0')).toBe(0);
  });
  it('returns null for empty or non-numeric cells', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
    expect(parsePrice('pay box חודש')).toBeNull();
  });
});

describe('parseSheetDate', () => {
  it('reads DD-MM-YYYY, DD/MM/YYYY and D.M.YYYY as day-first', () => {
    expect(parseSheetDate('13-07-2026')).toBe('2026-07-13');
    expect(parseSheetDate('05/10/2026')).toBe('2026-10-05');
    expect(parseSheetDate('1.9.2026')).toBe('2026-09-01');
  });
  it('reads ISO dates', () => {
    expect(parseSheetDate('2026-07-13')).toBe('2026-07-13');
  });
  it('returns null for junk and for dates that do not exist', () => {
    expect(parseSheetDate('pay box חודש')).toBeNull();
    expect(parseSheetDate('31-02-2026')).toBeNull();
    expect(parseSheetDate('')).toBeNull();
    expect(parseSheetDate(undefined)).toBeNull();
  });
});

describe('mapStatus', () => {
  it('maps the three statuses the sheet uses', () => {
    expect(mapStatus('פעיל')).toBe('active');
    expect(mapStatus(' בוטל ')).toBe('cancelled');
    expect(mapStatus('תשלום לא עבר')).toBe('payment_failed');
  });
  it('maps anything else to unknown', () => {
    expect(mapStatus('')).toBe('unknown');
    expect(mapStatus('מוקפא')).toBe('unknown');
  });
});

describe('parseSheet', () => {
  it('finds the header by its texts and keeps a student sitting above it', () => {
    const values = [
      ['Doron', '055-249-1243', 'doron@x.com', 'פעיל', '', '29-06-2026', '', '244'],
      HEADER,
      ['Yack', '055-268-9289', 'yack@x.com', 'פעיל', '', '', '', '₪244.00'],
      ['Naomi', '052-860-4705', 'naomi@x.com', 'בוטל', 'פתוח', '', 'pay box חודש', ''],
    ];
    const rows = parseSheet(values);
    expect(rows.map((r) => r.sheetRow)).toEqual([1, 3, 4]);
    expect(rows[0]).toMatchObject({
      fullName: 'Doron', email: 'doron@x.com', status: 'active', monthlyPrice: 244, startedAt: '2026-06-29',
    });
    expect(rows[2]).toMatchObject({ status: 'cancelled', monthlyPrice: null, cancelledAt: null });
  });

  it('skips rows with neither an email nor a phone', () => {
    const values = [HEADER, ['', '', '', '', '', '', '', ''], ['Only name', '', '', 'פעיל']];
    expect(parseSheet(values)).toEqual([]);
  });

  it('locates columns by header text, not position', () => {
    const values = [
      ['', 'סטטוס', 'מייל', 'טלפון', 'מחיר'],
      ['Ana', 'פעיל', 'ana@x.com', '050-0000000', '₪208.00'],
    ];
    expect(parseSheet(values)[0]).toMatchObject({ email: 'ana@x.com', phone: '050-0000000', monthlyPrice: 208 });
  });

  it('lower-cases and trims emails', () => {
    const values = [HEADER, ['A', '', '  Leah@Gmail.com ', 'פעיל']];
    expect(parseSheet(values)[0].email).toBe('leah@gmail.com');
  });

  it('throws when the header row is gone, so a sync never wipes the table', () => {
    const values = [['Doron', '055-249-1243', 'doron@x.com', 'פעיל']];
    expect(() => parseSheet(values)).toThrow(HeaderNotFoundError);
  });
});

describe('matchRow', () => {
  it('matches by email, case-insensitively', () => {
    const r = matchRow(row({ email: 'a@x.com' }), [profile({ email: 'A@X.com' })]);
    expect(r).toEqual({ userId: 'u1', method: 'email', note: null });
  });

  it('ignores a soft-deleted profile on the email path and falls back to phone', () => {
    const r = matchRow(row({ email: 'a@x.com', phone: '050-1234567' }), [
      profile({ id: 'dead', email: 'a@x.com', phone: null, deletedAt: '2026-08-01' }),
      profile({ id: 'live', email: 'other@x.com', phone: '+972 50 123 4567' }),
    ]);
    expect(r).toEqual({ userId: 'live', method: 'phone', note: null });
  });

  it('leaves an ambiguous phone unmatched instead of picking one', () => {
    const r = matchRow(row({ email: null, phone: '050-1234567' }), [
      profile({ id: 'a', email: null, phone: '0501234567' }),
      profile({ id: 'b', email: null, phone: '+972501234567' }),
    ]);
    expect(r).toEqual({ userId: null, method: null, note: 'ambiguous_phone' });
  });

  it('flags a phone that only matches a deleted account', () => {
    const r = matchRow(row({ email: null }), [profile({ email: null, deletedAt: '2026-08-01' })]);
    expect(r).toEqual({ userId: null, method: null, note: 'deleted_account' });
  });

  it('returns unmatched with no note when nothing fits', () => {
    expect(matchRow(row({ email: 'z@x.com', phone: '099-9999999' }), [profile()])).toEqual({
      userId: null, method: null, note: null,
    });
  });
});

describe('estimateDates', () => {
  it('keeps the sheet dates when present', () => {
    const e = estimateDates(row({ status: 'cancelled', startedAt: '2026-06-01', cancelledAt: '2026-09-01' }), {
      joinDate: '2026-05-01T00:00:00Z', revokedAt: '2026-10-01T00:00:00Z',
    });
    expect(e).toEqual({
      startedAt: '2026-06-01', startedAtSource: 'sheet', cancelledAt: '2026-09-01', cancelledAtSource: 'sheet',
    });
  });

  it('falls back to the platform signup date for a missing start', () => {
    const e = estimateDates(row(), { joinDate: '2026-07-01T09:00:00Z' });
    expect(e.startedAt).toBe('2026-07-01');
    expect(e.startedAtSource).toBe('platform_signup');
  });

  it('never invents a cancel date for an active student', () => {
    const e = estimateDates(row({ status: 'active' }), { revokedAt: '2026-09-01T00:00:00Z' });
    expect(e.cancelledAt).toBeNull();
    expect(e.cancelledAtSource).toBeNull();
  });

  it('prefers the access-revoked date over activity for a cancelled student', () => {
    const e = estimateDates(row({ status: 'cancelled', startedAt: '2026-06-01' }), {
      revokedAt: '2026-08-15T10:00:00Z', lastLessonAt: '2026-09-20T10:00:00Z',
    });
    expect(e).toMatchObject({ cancelledAt: '2026-08-15', cancelledAtSource: 'access_revoked' });
  });

  it('uses the latest real activity when access was never revoked', () => {
    const e = estimateDates(row({ status: 'cancelled', startedAt: '2026-06-01' }), {
      lastLessonAt: '2026-08-02T10:00:00Z',
      lastAuthEventAt: '2026-08-20T10:00:00Z',
      lastSignInAt: '2026-08-10T10:00:00Z',
    });
    expect(e).toMatchObject({ cancelledAt: '2026-08-20', cancelledAtSource: 'last_activity' });
  });

  it('ignores an activity ping stamped by the backfill', () => {
    const e = estimateDates(row({ status: 'cancelled', startedAt: '2026-06-01' }), {
      activityPingAt: ACTIVITY_TRACKING_SINCE,
      lastLessonAt: '2026-07-10T10:00:00Z',
    });
    expect(e).toMatchObject({ cancelledAt: '2026-07-10', cancelledAtSource: 'last_activity' });
  });

  it('counts a ping recorded after tracking started', () => {
    const e = estimateDates(row({ status: 'cancelled', startedAt: '2026-06-01' }), {
      activityPingAt: '2026-09-03T08:00:00Z',
      lastLessonAt: '2026-07-10T10:00:00Z',
    });
    expect(e).toMatchObject({ cancelledAt: '2026-09-03', cancelledAtSource: 'last_activity' });
  });

  it('discards an estimated cancel date that falls before the start', () => {
    const e = estimateDates(row({ status: 'cancelled', startedAt: '2026-09-01' }), {
      lastLessonAt: '2026-08-01T10:00:00Z',
    });
    expect(e.cancelledAt).toBeNull();
    expect(e.cancelledAtSource).toBeNull();
  });

  it('leaves the cancel date empty when there is no evidence at all', () => {
    const e = estimateDates(row({ status: 'cancelled' }), {});
    expect(e).toEqual({ startedAt: null, startedAtSource: null, cancelledAt: null, cancelledAtSource: null });
  });
});

describe('parseBridgeResponse', () => {
  it('returns the values the Apps Script bridge sent', () => {
    const text = JSON.stringify({ ok: true, values: [HEADER, ['A', '050-1234567']] });
    expect(parseBridgeResponse(200, text)).toEqual([HEADER, ['A', '050-1234567']]);
  });

  it('names the refusal when the token does not match', () => {
    const text = JSON.stringify({ ok: false, error: 'unauthorized' });
    expect(() => parseBridgeResponse(200, text)).toThrow(BridgeError);
    expect(() => parseBridgeResponse(200, text)).toThrow(/unauthorized/);
  });

  it('explains an HTML page (web app not deployed for "Anyone", or a Google error page)', () => {
    expect(() => parseBridgeResponse(401, '<!DOCTYPE html><html>…</html>')).toThrow(/HTTP 401/);
  });

  it('rejects an ok response with no values rather than syncing an empty sheet', () => {
    expect(() => parseBridgeResponse(200, JSON.stringify({ ok: true }))).toThrow(BridgeError);
  });
});
