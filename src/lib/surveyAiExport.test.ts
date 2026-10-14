import { describe, it, expect } from 'vitest';
import { buildAiExportRows, fillAiWorkbook, type SubscriptionContext } from './surveyAiExport';
import type { SurveyResponseRow } from './satisfactionSurvey';

let seq = 0;
const response = (over: Partial<SurveyResponseRow> = {}): SurveyResponseRow => ({
  id: `r${++seq}`,
  user_id: 'u1',
  period: '2026-10-01',
  tenure: 'gt_2m',
  would_recommend: true,
  overall_satisfaction: 4,
  needs_improvement: ['content', 'ai'],
  rating_clarity: 4,
  rating_continuity: 3,
  rating_lives: 2,
  rating_ai: 1,
  rating_feedback: 4,
  contribution: 'Mucho',
  suggestions: 'Más clases',
  comments: null,
  created_at: '2026-10-14T09:30:00Z',
  ...over,
});

const sub = (over: Partial<SubscriptionContext> = {}): SubscriptionContext => ({
  status: 'active',
  monthly_price: 244,
  started_at: '2026-06-14',
  cancelled_at: null,
  cancelled_at_source: null,
  ...over,
});

describe('buildAiExportRows', () => {
  it('never carries a name, an email or a portal user id', () => {
    const [row] = buildAiExportRows([response()], new Map());
    const keys = Object.keys(row);
    expect(keys).not.toContain('user_id');
    expect(keys.some((k) => /name|email|mail/i.test(k))).toBe(false);
    expect(JSON.stringify(row)).not.toContain('u1');
  });

  it('gives each student one code, in order of their first response, across months', () => {
    const rows = buildAiExportRows([
      response({ user_id: 'late', period: '2026-10-01', created_at: '2026-10-14T10:00:00Z' }),
      response({ user_id: 'early', period: '2026-10-01', created_at: '2026-10-14T08:00:00Z' }),
      response({ user_id: 'early', period: '2026-11-01', created_at: '2026-11-11T08:00:00Z' }),
    ], new Map());
    expect(rows.map((r) => [r.month, r.code])).toEqual([
      ['2026-10', 'S-001'],
      ['2026-10', 'S-002'],
      ['2026-11', 'S-001'],
    ]);
  });

  it('keeps ratings as numbers and improvement areas as codes for labelling', () => {
    const [row] = buildAiExportRows([response()], new Map());
    expect(row.overall).toBe(4);
    expect(row.ratings).toEqual({ clarity: 4, continuity: 3, lives: 2, ai: 1, feedback: 4 });
    expect(row.needsImprovement).toEqual(['content', 'ai']);
    expect(row.wouldRecommend).toBe(true);
    expect(row.answeredAt).toBe('2026-10-14');
    expect(row.comments).toBe('');
  });

  it('adds the student\'s subscription, with tenure measured at the moment they answered', () => {
    const [row] = buildAiExportRows(
      [response({ created_at: '2026-10-14T09:30:00Z' })],
      new Map([['u1', sub({ started_at: '2026-06-14' })]]),
    );
    expect(row.subscriptionStatus).toBe('active');
    expect(row.monthlyPrice).toBe(244);
    expect(row.customerSince).toBe('2026-06-14');
    // 122 days / 30.4375
    expect(row.monthsAsCustomer).toBe(4);
    expect(row.cancelledAt).toBeNull();
    expect(row.cancelDateEstimated).toBeNull();
  });

  it('flags a cancel date the sync estimated rather than read from the sheet', () => {
    const rows = buildAiExportRows(
      [response({ user_id: 'a' }), response({ user_id: 'b' })],
      new Map([
        ['a', sub({ status: 'cancelled', cancelled_at: '2026-10-20', cancelled_at_source: 'last_activity' })],
        ['b', sub({ status: 'cancelled', cancelled_at: '2026-10-20', cancelled_at_source: 'sheet' })],
      ]),
    );
    expect(rows.map((r) => [r.subscriptionStatus, r.cancelledAt, r.cancelDateEstimated])).toEqual([
      ['cancelled', '2026-10-20', true],
      ['cancelled', '2026-10-20', false],
    ]);
  });

  it('marks students missing from the subscriptions table, and leaves their columns empty', () => {
    const [row] = buildAiExportRows([response()], new Map());
    expect(row.subscriptionStatus).toBe('not_in_sheet');
    expect([row.monthlyPrice, row.customerSince, row.monthsAsCustomer]).toEqual([null, null, null]);
  });

  it('leaves tenure empty when the start date is after the answer (bad data, not negative months)', () => {
    const [row] = buildAiExportRows(
      [response({ created_at: '2026-10-14T09:30:00Z' })],
      new Map([['u1', sub({ started_at: '2026-11-01' })]]),
    );
    expect(row.monthsAsCustomer).toBeNull();
  });
});

describe('fillAiWorkbook', () => {
  // Echo translator: every label is its own key, so assertions read the structure.
  const t = (key: string) => key;

  it('writes a responses sheet and a guide, readable back by Excel tooling', async () => {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const rows = buildAiExportRows(
      [response({ user_id: 'u1', comments: 'Gracias' }), response({ user_id: 'u2', would_recommend: false })],
      new Map([['u1', sub({ status: 'cancelled', cancelled_at: '2026-10-20', cancelled_at_source: 'access_revoked' })]]),
    );
    fillAiWorkbook(wb, rows, t, '2026-10-14');

    const back = new ExcelJS.Workbook();
    await back.xlsx.load(await wb.xlsx.writeBuffer());
    expect(back.worksheets.map((w) => w.name)).toEqual(['surveys.ai.sheetResponses', 'surveys.ai.sheetGuide']);

    const ws = back.worksheets[0];
    expect(ws.rowCount).toBe(3);
    const headers = (ws.getRow(1).values as unknown[]).slice(1);
    expect(headers.slice(0, 4)).toEqual(['surveys.ai.col.code', 'surveys.ai.col.month', 'surveys.ai.col.answeredAt', 'surveys.ai.col.status']);
    expect(headers).toContain('survey.aspect.clarity (1–4)');

    const first = (ws.getRow(2).values as unknown[]).slice(1);
    expect(first.slice(0, 4)).toEqual(['S-001', '2026-10', '2026-10-14', 'manageUsers.subs.status.cancelled']);
    expect(first).toContain('survey.yes');         // cancel date estimated
    expect(first).toContain('Gracias');
    const second = (ws.getRow(3).values as unknown[]).slice(1);
    expect(second[3]).toBe('surveys.ai.status.not_in_sheet');

    const guide = back.worksheets[1];
    expect(guide.rowCount).toBe(12);
    expect(String(guide.getRow(2).getCell(2).value)).toBe('surveys.ai.guide.file');
  });

  it('puts no portal id anywhere in the file', async () => {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const userId = '1accc7b1-0000-4000-8000-000000000000';
    fillAiWorkbook(wb, buildAiExportRows([response({ user_id: userId })], new Map()), t, '2026-10-14');
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(await wb.xlsx.writeBuffer());
    const everything = back.worksheets.flatMap((w) => w.getSheetValues()).flat(2).map(String).join(' ');
    expect(everything).not.toContain(userId);
  });
});
