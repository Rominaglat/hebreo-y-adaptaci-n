// Rows for the "export for AI analysis" workbook on /admin/surveys.
//
// Unlike the per-month export next to it, this one is meant to be pasted into
// an external AI service, so it is built around three rules:
//   - no names, emails or portal ids: each student is an anonymous code
//     (S-001, S-002 … in order of their first response), stable within the file
//     so the AI can follow one student across months;
//   - every month in one file, ratings as numbers, answers as stable codes the
//     page labels via t();
//   - each response carries the student's subscription (from the synced
//     customer sheet), so satisfaction can be read against cancellations.

import {
  ASPECTS,
  ASPECT_COLUMN,
  SURVEY_TIME_ZONE,
  type Aspect,
  type SurveyResponseRow,
} from './satisfactionSurvey';
import type { SubscriptionRow } from './subscriptionMetrics';
// Type-only: erased at build time, so exceljs stays a lazy import in the page.
import type { Alignment, Workbook } from 'exceljs';

export type SubscriptionContext = Pick<
  SubscriptionRow,
  'status' | 'monthly_price' | 'started_at' | 'cancelled_at' | 'cancelled_at_source'
>;

export type ExportSubscriptionStatus = SubscriptionRow['status'] | 'not_in_sheet';

export interface AiExportRow {
  code: string;
  /** YYYY-MM */
  month: string;
  /** YYYY-MM-DD, Israel time */
  answeredAt: string;
  subscriptionStatus: ExportSubscriptionStatus;
  monthlyPrice: number | null;
  customerSince: string | null;
  /** Months between the subscription start and this answer, one decimal. */
  monthsAsCustomer: number | null;
  cancelledAt: string | null;
  /** true = the sync estimated it (access revoked / last activity); null = no cancel date. */
  cancelDateEstimated: boolean | null;
  /** Survey answer codes, labelled by the page. */
  tenure: string;
  wouldRecommend: boolean;
  /** 1–5 */
  overall: number;
  needsImprovement: string[];
  /** 1–4 each */
  ratings: Record<Aspect, number>;
  contribution: string;
  suggestions: string;
  comments: string;
}

const DAYS_PER_MONTH = 30.4375;
const DAY_MS = 86_400_000;

const israelDay = (iso: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: SURVEY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(iso));

function monthsBetween(fromDay: string, toDay: string): number | null {
  const days = (Date.parse(toDay) - Date.parse(fromDay)) / DAY_MS;
  if (!Number.isFinite(days) || days < 0) return null;
  return Math.round((days / DAYS_PER_MONTH) * 10) / 10;
}

/** subsByUser: one subscription per portal user (see pickPerUser). */
export function buildAiExportRows(
  responses: SurveyResponseRow[],
  subsByUser: Map<string, SubscriptionContext>,
): AiExportRow[] {
  const firstAnswer = new Map<string, string>();
  for (const r of responses) {
    const seen = firstAnswer.get(r.user_id);
    if (!seen || r.created_at < seen) firstAnswer.set(r.user_id, r.created_at);
  }
  const codeByUser = new Map(
    [...firstAnswer.entries()]
      .sort(([ua, a], [ub, b]) => (a === b ? ua.localeCompare(ub) : a.localeCompare(b)))
      .map(([userId], i) => [userId, `S-${String(i + 1).padStart(3, '0')}`]),
  );

  return [...responses]
    .sort((a, b) => a.period.localeCompare(b.period) || codeByUser.get(a.user_id)!.localeCompare(codeByUser.get(b.user_id)!))
    .map((r) => {
      const answeredAt = israelDay(r.created_at);
      const sub = subsByUser.get(r.user_id);
      return {
        code: codeByUser.get(r.user_id)!,
        month: r.period.slice(0, 7),
        answeredAt,
        subscriptionStatus: sub ? sub.status : 'not_in_sheet',
        monthlyPrice: sub?.monthly_price ?? null,
        customerSince: sub?.started_at ?? null,
        monthsAsCustomer: sub?.started_at ? monthsBetween(sub.started_at, answeredAt) : null,
        cancelledAt: sub?.cancelled_at ?? null,
        cancelDateEstimated: sub?.cancelled_at ? sub.cancelled_at_source !== 'sheet' : null,
        tenure: r.tenure,
        wouldRecommend: r.would_recommend,
        overall: r.overall_satisfaction,
        needsImprovement: r.needs_improvement,
        ratings: Object.fromEntries(ASPECTS.map((a) => [a, r[ASPECT_COLUMN[a]]])) as Record<Aspect, number>,
        contribution: r.contribution,
        suggestions: r.suggestions,
        comments: r.comments ?? '',
      };
    });
}

type Translate = (key: string) => string;

/**
 * Two sheets: the responses (one row per answer) and a guide the AI reads first —
 * what each column and scale means. Labels come from t(), in the admin's language.
 */
export function fillAiWorkbook(wb: Workbook, rows: AiExportRow[], t: Translate, today: string): void {
  const statusLabel = (s: ExportSubscriptionStatus) =>
    t(s === 'not_in_sheet' ? 'surveys.ai.status.not_in_sheet' : `manageUsers.subs.status.${s}`);
  const yesNo = (b: boolean | null) => (b === null ? '' : t(b ? 'survey.yes' : 'survey.no'));
  const wrapTop: Partial<Alignment> = { vertical: 'top', wrapText: true };

  const sheetName = t('surveys.ai.sheetResponses');
  const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
  const header = {
    code: t('surveys.ai.col.code'),
    month: t('surveys.ai.col.month'),
    answeredAt: t('surveys.ai.col.answeredAt'),
    status: t('surveys.ai.col.status'),
    price: t('surveys.ai.col.price'),
    since: t('surveys.ai.col.since'),
    months: t('surveys.ai.col.months'),
    cancelledAt: t('surveys.ai.col.cancelledAt'),
    cancelEstimated: t('surveys.ai.col.cancelEstimated'),
    tenure: t('survey.q.tenure'),
    recommend: t('survey.q.recommend'),
    overall: `${t('survey.q.overall')} (1–5)`,
    improvement: t('survey.q.improvement'),
    contribution: t('survey.q.contribution'),
    suggestions: t('survey.q.suggestions'),
    comments: t('survey.q.comments'),
  };
  ws.columns = [
    { header: header.code, key: 'code', width: 12 },
    { header: header.month, key: 'month', width: 12 },
    { header: header.answeredAt, key: 'answeredAt', width: 14 },
    { header: header.status, key: 'status', width: 18 },
    { header: header.price, key: 'price', width: 14 },
    { header: header.since, key: 'since', width: 14 },
    { header: header.months, key: 'months', width: 16 },
    { header: header.cancelledAt, key: 'cancelledAt', width: 14 },
    { header: header.cancelEstimated, key: 'cancelEstimated', width: 14 },
    { header: header.tenure, key: 'tenure', width: 18 },
    { header: header.recommend, key: 'recommend', width: 14 },
    { header: header.overall, key: 'overall', width: 14 },
    { header: header.improvement, key: 'improvement', width: 36 },
    ...ASPECTS.map((a) => ({ header: `${t(`survey.aspect.${a}`)} (1–4)`, key: `aspect_${a}`, width: 18 })),
    { header: header.contribution, key: 'contribution', width: 50 },
    { header: header.suggestions, key: 'suggestions', width: 50 },
    { header: header.comments, key: 'comments', width: 50 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow({
      code: r.code,
      month: r.month,
      answeredAt: r.answeredAt,
      status: statusLabel(r.subscriptionStatus),
      price: r.monthlyPrice,
      since: r.customerSince,
      months: r.monthsAsCustomer,
      cancelledAt: r.cancelledAt,
      cancelEstimated: yesNo(r.cancelDateEstimated),
      tenure: t(`survey.tenure.${r.tenure}`),
      recommend: yesNo(r.wouldRecommend),
      overall: r.overall,
      improvement: r.needsImprovement.map((c) => t(`survey.improvement.${c}`)).join('; '),
      ...Object.fromEntries(ASPECTS.map((a) => [`aspect_${a}`, r.ratings[a]])),
      contribution: r.contribution,
      suggestions: r.suggestions,
      comments: r.comments,
    }).alignment = wrapTop;
  }

  const guide = wb.addWorksheet(t('surveys.ai.sheetGuide'));
  guide.columns = [
    { header: t('surveys.ai.guideColumn'), key: 'column', width: 34 },
    { header: t('surveys.ai.guideMeaning'), key: 'meaning', width: 100 },
  ];
  guide.getRow(1).font = { bold: true };
  const levels = [1, 2, 3, 4].map((n) => `${n} = ${t(`survey.level.${n}`)}`).join(', ');
  const textMeaning = t('surveys.ai.guide.text');
  const guideRows: Array<[string, string]> = [
    ['', t('surveys.ai.guide.file').replace('{sheet}', sheetName).replace('{date}', today)],
    [header.code, t('surveys.ai.guide.code')],
    [header.status, t('surveys.ai.guide.status')],
    [header.months, t('surveys.ai.guide.months')],
    [header.cancelEstimated, t('surveys.ai.guide.cancelEstimated')],
    [header.overall, t('surveys.ai.guide.overall').replace('{min}', t('survey.overall.min')).replace('{max}', t('survey.overall.max'))],
    [ASPECTS.map((a) => t(`survey.aspect.${a}`)).join(' / '), t('surveys.ai.guide.aspects').replace('{levels}', levels)],
    [header.improvement, t('surveys.ai.guide.improvement')],
    [header.contribution, textMeaning],
    [header.suggestions, textMeaning],
    [header.comments, textMeaning],
  ];
  for (const [column, meaning] of guideRows) guide.addRow({ column, meaning }).alignment = wrapTop;
}
