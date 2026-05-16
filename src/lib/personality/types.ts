// Shared types for the personality assessment feature.
// Used by frontend, scoring helpers, and (in compatible form) the edge function.

export type EmythAxis = 'EM' | 'MN' | 'AR'; // Entrepreneur, Manager, Artisan
export type DiscColor = 'R' | 'Y' | 'G' | 'B'; // Red, Yellow, Green, Blue
/** All Likert items measure exactly one of these dimensions. */
export type LikertAxis = EmythAxis | DiscColor;

export interface LikertQuestion {
  qid: string;
  type: 'likert';
  axis: LikertAxis;
  text: string;
  reverse?: boolean;
}

export interface ForcedChoiceOption {
  color: DiscColor;
  text: string;
}

export interface ForcedChoiceQuestion {
  qid: string;
  type: 'forced_choice';
  options: ForcedChoiceOption[];
}

export type Question = LikertQuestion | ForcedChoiceQuestion;

export interface LikertAnswer {
  qid: string;
  type: 'likert';
  axis: LikertAxis;
  value: 1 | 2 | 3 | 4 | 5;
}

export interface ForcedChoiceAnswer {
  qid: string;
  type: 'forced_choice';
  /** The single option the user picked as most-like-them. */
  most: DiscColor;
  /** Optional. Kept for backwards compatibility with the original ipsative design;
   *  current UI is single-pick and leaves this undefined. */
  least?: DiscColor;
}

export type Answer = LikertAnswer | ForcedChoiceAnswer;

export interface EmythStrengths {
  entrepreneur: number; // 0-100, independent per axis (does NOT sum to 100)
  manager: number;
  artisan: number;
}

export interface EmythScores {
  // Shares: each axis as a percent of the personality "pie" (sums to 100).
  // Kept as flat fields for backward compatibility with v1 assessments.
  entrepreneur: number;
  manager: number;
  artisan: number;
  // v3-only: absolute strength per axis (each 0-100, independent).
  strengths?: EmythStrengths;
  // v3-only: interpretive label derived from the strength pattern,
  // e.g. "יזם מובהק", "פרופיל מעורב יזם-מנהל", "פרופיל לא מובהק".
  dominance_label?: string;
}

export interface DiscStrengths {
  R: number; // 0-100, independent
  Y: number;
  G: number;
  B: number;
}

export interface DiscScores {
  // Shares (sums to 100). Backward-compatible with v1.
  R: number;
  Y: number;
  G: number;
  B: number;
  // v3-only: absolute strength per color (each 0-100, independent).
  strengths?: DiscStrengths;
}

export interface Insights {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  communication_style: string;
  action_recommendations: string[];
}

/** Scoring algorithm version. v1 = shares-only legacy; v3 = centered-strength model. */
export type ScoringVersion = 'v1' | 'v3';

export interface PersonalityAssessment {
  id: string;
  user_id: string;
  tenant_id: string;
  version: number;
  answers: Answer[];
  emyth_scores: EmythScores;
  disc_scores: DiscScores;
  disc_primary: DiscColor;
  disc_secondary: DiscColor | null;
  insights: Insights;
  raw_ai_response: unknown;
  model: string;
  created_at: string;
  /** Present after the v3 migration. Older rows read as 'v1'. */
  scoring_version?: ScoringVersion;
}

export const DISC_COLOR_NAMES_HE: Record<DiscColor, string> = {
  R: 'אדום',
  Y: 'צהוב',
  G: 'ירוק',
  B: 'כחול',
};

export const DISC_COLOR_LABELS_HE: Record<DiscColor, string> = {
  R: 'משימתי',
  Y: 'מקדם',
  G: 'מכיל',
  B: 'מנתח',
};

export const EMYTH_AXIS_NAMES_HE: Record<EmythAxis, string> = {
  EM: 'יזם',
  MN: 'מנהל',
  AR: 'אומן',
};
