// Pure logic for the monthly satisfaction survey (/encuesta + /admin/surveys).
// No I/O — safe to unit-test and to import from both pages.
//
// Answers are stored as stable codes, never as display text, so the survey can be
// shown in es/he/en and the admin view/Excel export translate them back via t().

export const SURVEY_PATH = '/encuesta';

/** The month boundary is Israel time — must match the DB trigger in 20260930100000. */
export const SURVEY_TIME_ZONE = 'Asia/Jerusalem';

export const TEXT_MAX = 5000;

export const TENURE_OPTIONS = ['lt_1m', 'gt_1m', 'gt_2m'] as const;
export type Tenure = (typeof TENURE_OPTIONS)[number];

export const IMPROVEMENT_OPTIONS = ['content', 'group', 'ai', 'lives', 'nothing'] as const;
export type Improvement = (typeof IMPROVEMENT_OPTIONS)[number];

export const ASPECTS = ['clarity', 'continuity', 'lives', 'ai', 'feedback'] as const;
export type Aspect = (typeof ASPECTS)[number];

/** 1 = Muy insatisfecho … 4 = Muy satisfecho */
export const ASPECT_LEVELS = [1, 2, 3, 4] as const;
/** 1 = Muy insatisfecho … 5 = Muy satisfecho */
export const OVERALL_LEVELS = [1, 2, 3, 4, 5] as const;

export interface SurveyDraft {
  tenure: Tenure | null;
  wouldRecommend: boolean | null;
  overall: number | null;
  needsImprovement: Improvement[];
  ratings: Partial<Record<Aspect, number>>;
  contribution: string;
  suggestions: string;
  comments: string;
}

export const emptyDraft = (): SurveyDraft => ({
  tenure: null,
  wouldRecommend: null,
  overall: null,
  needsImprovement: [],
  ratings: {},
  contribution: '',
  suggestions: '',
  comments: '',
});

/** Required questions, in the order they appear on the page. */
export type SurveyField =
  | 'tenure' | 'wouldRecommend' | 'overall' | 'needsImprovement' | 'ratings' | 'contribution' | 'suggestions';

export function missingFields(d: SurveyDraft): SurveyField[] {
  const missing: SurveyField[] = [];
  if (!d.tenure) missing.push('tenure');
  if (d.wouldRecommend === null) missing.push('wouldRecommend');
  if (d.overall === null) missing.push('overall');
  if (d.needsImprovement.length === 0) missing.push('needsImprovement');
  if (ASPECTS.some((a) => d.ratings[a] == null)) missing.push('ratings');
  if (!d.contribution.trim()) missing.push('contribution');
  if (!d.suggestions.trim()) missing.push('suggestions');
  return missing;
}

/** Checkbox toggle where "nothing" is exclusive with every real improvement area. */
export function toggleImprovement(current: Improvement[], option: Improvement): Improvement[] {
  if (option === 'nothing') return current.includes('nothing') ? [] : ['nothing'];
  const next = new Set<Improvement>(current.filter((o) => o !== 'nothing'));
  if (next.has(option)) next.delete(option);
  else next.add(option);
  return IMPROVEMENT_OPTIONS.filter((o) => next.has(o));
}

export interface SurveyInsert {
  user_id: string;
  tenure: Tenure;
  would_recommend: boolean;
  overall_satisfaction: number;
  needs_improvement: Improvement[];
  rating_clarity: number;
  rating_continuity: number;
  rating_lives: number;
  rating_ai: number;
  rating_feedback: number;
  contribution: string;
  suggestions: string;
  comments: string | null;
}

export function toInsertRow(d: SurveyDraft, userId: string): SurveyInsert {
  const missing = missingFields(d);
  if (missing.length > 0) throw new Error(`Survey incomplete: ${missing.join(', ')}`);
  const comments = d.comments.trim();
  return {
    user_id: userId,
    tenure: d.tenure as Tenure,
    would_recommend: d.wouldRecommend as boolean,
    overall_satisfaction: d.overall as number,
    needs_improvement: d.needsImprovement,
    rating_clarity: d.ratings.clarity as number,
    rating_continuity: d.ratings.continuity as number,
    rating_lives: d.ratings.lives as number,
    rating_ai: d.ratings.ai as number,
    rating_feedback: d.ratings.feedback as number,
    contribution: d.contribution.trim(),
    suggestions: d.suggestions.trim(),
    comments: comments || null,
  };
}

export interface SurveyResponseRow {
  id: string;
  user_id: string;
  period: string;
  tenure: string;
  would_recommend: boolean;
  overall_satisfaction: number;
  needs_improvement: string[];
  rating_clarity: number;
  rating_continuity: number;
  rating_lives: number;
  rating_ai: number;
  rating_feedback: number;
  contribution: string;
  suggestions: string;
  comments: string | null;
  created_at: string;
}

export const ASPECT_COLUMN = {
  clarity: 'rating_clarity',
  continuity: 'rating_continuity',
  lives: 'rating_lives',
  ai: 'rating_ai',
  feedback: 'rating_feedback',
} as const satisfies Record<Aspect, keyof SurveyResponseRow>;

export interface SurveySummary {
  count: number;
  avgOverall: number | null;
  /** Whole-number percentage of respondents who would recommend, or null with no responses. */
  recommendPct: number | null;
  improvementCounts: Record<Improvement, number>;
  aspectAverages: Record<Aspect, number | null>;
}

const avg = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length);

export function summarize(rows: SurveyResponseRow[]): SurveySummary {
  const improvementCounts = Object.fromEntries(IMPROVEMENT_OPTIONS.map((o) => [o, 0])) as Record<Improvement, number>;
  for (const r of rows) {
    for (const code of r.needs_improvement) {
      if (code in improvementCounts) improvementCounts[code as Improvement] += 1;
    }
  }
  const aspectAverages = Object.fromEntries(
    ASPECTS.map((a) => [a, avg(rows.map((r) => r[ASPECT_COLUMN[a]]))]),
  ) as Record<Aspect, number | null>;

  return {
    count: rows.length,
    avgOverall: avg(rows.map((r) => r.overall_satisfaction)),
    recommendPct: rows.length === 0 ? null : Math.round((rows.filter((r) => r.would_recommend).length / rows.length) * 100),
    improvementCounts,
    aspectAverages,
  };
}

/** First day of the survey month containing `now`, as 'YYYY-MM-01' (Israel time). */
export function surveyPeriod(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: SURVEY_TIME_ZONE, year: 'numeric', month: '2-digit' })
    .formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  return `${year}-${month}-01`;
}

// Same resolution as AuthContext: highest role wins, no rows at all means student.
const ROLE_HIERARCHY = ['super_admin', 'admin', 'instructor', 'student', 'lead'] as const;
export type AppRole = (typeof ROLE_HIERARCHY)[number];

export function effectiveRole(roles: string[]): AppRole {
  let best: AppRole | null = null;
  for (const r of roles) {
    const idx = ROLE_HIERARCHY.indexOf(r as AppRole);
    if (idx < 0) continue;
    if (best === null || idx < ROLE_HIERARCHY.indexOf(best)) best = ROLE_HIERARCHY[idx];
  }
  return best ?? 'student';
}

/** Students the survey is meant for: effective role student, profile not soft-deleted. */
export function activeStudentIds(
  profiles: { id: string; deleted_at: string | null }[],
  roleRows: { user_id: string; role: string }[],
): Set<string> {
  const rolesByUser = new Map<string, string[]>();
  for (const r of roleRows) {
    const list = rolesByUser.get(r.user_id) ?? [];
    list.push(r.role);
    rolesByUser.set(r.user_id, list);
  }
  return new Set(
    profiles
      .filter((p) => !p.deleted_at && effectiveRole(rolesByUser.get(p.id) ?? []) === 'student')
      .map((p) => p.id),
  );
}
