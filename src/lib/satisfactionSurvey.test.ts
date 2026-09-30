import { describe, it, expect } from 'vitest';
import {
  activeStudentIds,
  effectiveRole,
  emptyDraft,
  missingFields,
  summarize,
  surveyPeriod,
  toInsertRow,
  toggleImprovement,
  type SurveyDraft,
  type SurveyResponseRow,
} from './satisfactionSurvey';

const completeDraft = (): SurveyDraft => ({
  tenure: 'gt_1m',
  wouldRecommend: true,
  overall: 4,
  needsImprovement: ['ai'],
  ratings: { clarity: 4, continuity: 3, lives: 4, ai: 2, feedback: 3 },
  contribution: 'Mucho',
  suggestions: 'Más vivos',
  comments: '',
});

const row = (over: Partial<SurveyResponseRow> = {}): SurveyResponseRow => ({
  id: 'r1',
  user_id: 'u1',
  period: '2026-10-01',
  tenure: 'gt_1m',
  would_recommend: true,
  overall_satisfaction: 4,
  needs_improvement: ['ai'],
  rating_clarity: 4,
  rating_continuity: 3,
  rating_lives: 4,
  rating_ai: 2,
  rating_feedback: 3,
  contribution: 'x',
  suggestions: 'y',
  comments: null,
  created_at: '2026-10-02T10:00:00Z',
  ...over,
});

describe('missingFields', () => {
  it('reports every required question on an empty draft, but not the optional comment', () => {
    expect(missingFields(emptyDraft())).toEqual([
      'tenure', 'wouldRecommend', 'overall', 'needsImprovement', 'ratings', 'contribution', 'suggestions',
    ]);
  });

  it('is empty for a complete draft', () => {
    expect(missingFields(completeDraft())).toEqual([]);
  });

  it('treats a false "would recommend" as answered', () => {
    expect(missingFields({ ...completeDraft(), wouldRecommend: false })).toEqual([]);
  });

  it('flags the grid until every aspect is rated', () => {
    const d = completeDraft();
    d.ratings = { clarity: 4, continuity: 3, lives: 4, ai: 2 };
    expect(missingFields(d)).toEqual(['ratings']);
  });

  it('treats whitespace-only text as unanswered', () => {
    expect(missingFields({ ...completeDraft(), contribution: '   \n ' })).toEqual(['contribution']);
  });
});

describe('toggleImprovement', () => {
  it('adds and removes options, keeping a stable order', () => {
    expect(toggleImprovement(['lives'], 'content')).toEqual(['content', 'lives']);
    expect(toggleImprovement(['content', 'lives'], 'content')).toEqual(['lives']);
  });

  it('"nothing" clears every other choice', () => {
    expect(toggleImprovement(['content', 'ai'], 'nothing')).toEqual(['nothing']);
  });

  it('picking a real area drops "nothing"', () => {
    expect(toggleImprovement(['nothing'], 'group')).toEqual(['group']);
  });

  it('unticking "nothing" leaves nothing selected', () => {
    expect(toggleImprovement(['nothing'], 'nothing')).toEqual([]);
  });
});

describe('toInsertRow', () => {
  it('maps the draft to table columns, trimming text and nulling an empty comment', () => {
    const d = { ...completeDraft(), contribution: '  Mucho  ', comments: '   ' };
    expect(toInsertRow(d, 'user-1')).toEqual({
      user_id: 'user-1',
      tenure: 'gt_1m',
      would_recommend: true,
      overall_satisfaction: 4,
      needs_improvement: ['ai'],
      rating_clarity: 4,
      rating_continuity: 3,
      rating_lives: 4,
      rating_ai: 2,
      rating_feedback: 3,
      contribution: 'Mucho',
      suggestions: 'Más vivos',
      comments: null,
    });
  });

  it('keeps a non-empty comment', () => {
    expect(toInsertRow({ ...completeDraft(), comments: ' Gracias ' }, 'u').comments).toBe('Gracias');
  });

  it('refuses an incomplete draft', () => {
    expect(() => toInsertRow(emptyDraft(), 'u')).toThrow();
  });
});

describe('summarize', () => {
  it('returns nulls, not NaN, when there are no responses', () => {
    const s = summarize([]);
    expect(s.count).toBe(0);
    expect(s.avgOverall).toBeNull();
    expect(s.recommendPct).toBeNull();
    expect(s.aspectAverages.clarity).toBeNull();
    expect(s.improvementCounts.ai).toBe(0);
  });

  it('averages scores, counts improvement areas and computes the recommend share', () => {
    const s = summarize([
      row({ overall_satisfaction: 5, would_recommend: true, needs_improvement: ['ai', 'lives'], rating_clarity: 4 }),
      row({ id: 'r2', overall_satisfaction: 4, would_recommend: true, needs_improvement: ['ai'], rating_clarity: 3 }),
      row({ id: 'r3', overall_satisfaction: 2, would_recommend: false, needs_improvement: ['nothing'], rating_clarity: 1 }),
    ]);
    expect(s.count).toBe(3);
    expect(s.avgOverall).toBeCloseTo(11 / 3);
    expect(s.recommendPct).toBe(67);
    expect(s.improvementCounts).toEqual({ content: 0, group: 0, ai: 2, lives: 1, nothing: 1 });
    expect(s.aspectAverages.clarity).toBeCloseTo(8 / 3);
  });

  it('ignores improvement codes it does not know', () => {
    expect(summarize([row({ needs_improvement: ['ai', 'bogus'] })]).improvementCounts.ai).toBe(1);
  });
});

describe('surveyPeriod', () => {
  it('uses Israel time, so the last evening of the month (UTC) already counts as next month', () => {
    // 21:30 UTC on Sep 30 is 00:30 on Oct 1 in Jerusalem (IDT, UTC+3).
    expect(surveyPeriod(new Date('2026-09-30T21:30:00Z'))).toBe('2026-10-01');
    expect(surveyPeriod(new Date('2026-09-30T20:30:00Z'))).toBe('2026-09-01');
  });

  it('handles winter time (UTC+2) and the year boundary', () => {
    expect(surveyPeriod(new Date('2026-12-31T22:30:00Z'))).toBe('2027-01-01');
    expect(surveyPeriod(new Date('2026-12-31T21:30:00Z'))).toBe('2026-12-01');
  });
});

describe('effectiveRole', () => {
  it('defaults to student when the user has no role rows (matches AuthContext)', () => {
    expect(effectiveRole([])).toBe('student');
  });

  it('picks the highest role', () => {
    expect(effectiveRole(['lead', 'student'])).toBe('student');
    expect(effectiveRole(['student', 'admin'])).toBe('admin');
    expect(effectiveRole(['lead'])).toBe('lead');
  });

  it('ignores unknown roles', () => {
    expect(effectiveRole(['mystery'])).toBe('student');
    expect(effectiveRole(['mystery', 'lead'])).toBe('lead');
  });
});

describe('activeStudentIds', () => {
  it('keeps effective students (including role-less users) and drops staff, leads and deleted profiles', () => {
    const profiles = [
      { id: 'student', deleted_at: null },
      { id: 'no-role', deleted_at: null },
      { id: 'lead', deleted_at: null },
      { id: 'lead-then-student', deleted_at: null },
      { id: 'admin', deleted_at: null },
      { id: 'deleted', deleted_at: '2026-01-01T00:00:00Z' },
    ];
    const roles = [
      { user_id: 'student', role: 'student' },
      { user_id: 'lead', role: 'lead' },
      { user_id: 'lead-then-student', role: 'lead' },
      { user_id: 'lead-then-student', role: 'student' },
      { user_id: 'admin', role: 'admin' },
      { user_id: 'deleted', role: 'student' },
    ];
    expect([...activeStudentIds(profiles, roles)].sort()).toEqual(['lead-then-student', 'no-role', 'student']);
  });
});
