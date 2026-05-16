// Deterministic scoring for the personality assessment — v3 model.
// Same algorithm runs in the edge function (Deno) — keep this pure and dependency-free.
// The edge function is the source of truth; the client may compute previews but should not persist.
//
// v3 model — fixes the "everyone looks balanced" problem of v1:
//   1. Likert answers are CENTERED around the neutral midpoint (value − 3 → range -2..+2).
//      Reverse-keyed items flip sign. "All 3s" → zero signal on every axis (correct).
//   2. Each axis gets an INDEPENDENT strength score (0-100) — how far the user leaned
//      toward that axis vs the theoretical max. Strengths do NOT sum to 100.
//   3. Shares (sum to 100) are derived from strengths only for the donut/proportional view.
//   4. A human-readable dominance label is computed from the strength pattern.

import type {
  Answer,
  DiscColor,
  DiscScores,
  DiscStrengths,
  EmythAxis,
  EmythScores,
  EmythStrengths,
  LikertAnswer,
  ForcedChoiceAnswer,
  Question,
} from './types';
import { EMYTH_AXIS_NAMES_HE, DISC_COLOR_NAMES_HE } from './types';

const SECONDARY_STRENGTH_THRESHOLD = 40; // v3: secondary DISC color requires strength ≥ 40 (independent)
// Baseline added to each axis's strength before computing shares — guarantees
// no axis displays as 0% of the personality. Real people have *some* of every
// trait even when one is overwhelmingly dominant (per the E-Myth model itself).
// 10 yields a max-dominance share of ~85% (E-Myth, 3 axes) / ~79% (DISC, 4 colors).
const SHARE_BASELINE = 10;
const EMYTH_AXES: EmythAxis[] = ['EM', 'MN', 'AR'];
const DISC_COLORS: DiscColor[] = ['R', 'Y', 'G', 'B'];

function isLikert(a: Answer): a is LikertAnswer {
  return a.type === 'likert';
}

function isForcedChoice(a: Answer): a is ForcedChoiceAnswer {
  return a.type === 'forced_choice';
}

function isEmythAxis(s: string): s is EmythAxis {
  return EMYTH_AXES.includes(s as EmythAxis);
}

function isDiscColor(s: string): s is DiscColor {
  return DISC_COLORS.includes(s as DiscColor);
}

/**
 * Build a qid → reverse map from the question bank.
 */
export function buildReverseMap(questions: Question[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const q of questions) {
    if (q.type === 'likert' && q.reverse) {
      map[q.qid] = true;
    }
  }
  return map;
}

// ─── core math: centered strength ─────────────────────────────────────

/**
 * Centered score for one Likert answer: maps 1..5 → -2..+2, flipping sign for reverse-keyed items.
 * "Neutral" answers (value = 3) contribute zero — no signal in either direction.
 */
function centeredContribution(a: LikertAnswer, isReverse: boolean): number {
  const centered = a.value - 3; // 1→-2, 2→-1, 3→0, 4→+1, 5→+2
  return isReverse ? -centered : centered;
}

/**
 * Convert a centered sum into a 0-100 independent strength score.
 * itemsOnAxis = number of Likert items measuring this axis; max possible centered sum is 2 * items.
 * Negative centered sums (net disagreement with this axis) clamp to 0.
 */
function strengthFromCenteredSum(centeredSum: number, itemsOnAxis: number): number {
  if (itemsOnAxis <= 0) return 0;
  const maxPossible = 2 * itemsOnAxis;
  const raw = (centeredSum / maxPossible) * 100;
  if (raw <= 0) return 0;
  if (raw >= 100) return 100;
  return Math.round(raw);
}

// ─── E-Myth scoring ───────────────────────────────────────────────────

/**
 * Compute E-Myth strengths (each 0-100, INDEPENDENT — do not sum to 100).
 * Returns rounded integers, suitable for direct display.
 */
export function computeEmythStrengths(
  answers: Answer[],
  reverseMap: Record<string, boolean>,
): EmythStrengths {
  const centered: Record<EmythAxis, number> = { EM: 0, MN: 0, AR: 0 };
  const counts: Record<EmythAxis, number> = { EM: 0, MN: 0, AR: 0 };
  for (const a of answers) {
    if (!isLikert(a)) continue;
    if (!isEmythAxis(a.axis)) continue;
    centered[a.axis] += centeredContribution(a, !!reverseMap[a.qid]);
    counts[a.axis] += 1;
  }
  return {
    entrepreneur: strengthFromCenteredSum(centered.EM, counts.EM),
    manager: strengthFromCenteredSum(centered.MN, counts.MN),
    artisan: strengthFromCenteredSum(centered.AR, counts.AR),
  };
}

/**
 * Compute the full v3 E-Myth score object: strengths (independent 0-100) plus
 * shares derived from strengths (sum to 100, for donut/ring proportional view).
 * If all strengths are zero (e.g. user answered all 3s) shares fall back to an
 * even split — the empty-signal case is signalled via `dominance_label` instead.
 */
export function computeEmythScores(
  answers: Answer[],
  reverseMap: Record<string, boolean>,
): EmythScores {
  const strengths = computeEmythStrengths(answers, reverseMap);
  // Baseline-adjusted strengths for the share split. Without the floor, an
  // axis whose centered sum is ≤ 0 lands at strength=0 and disappears from
  // the pie entirely (100/0/0 is mathematically possible but psychologically
  // wrong — everyone has some entrepreneur / manager / artisan in them).
  const adjusted = {
    entrepreneur: strengths.entrepreneur + SHARE_BASELINE,
    manager: strengths.manager + SHARE_BASELINE,
    artisan: strengths.artisan + SHARE_BASELINE,
  };
  const total = adjusted.entrepreneur + adjusted.manager + adjusted.artisan;
  const raw = {
    entrepreneur: (adjusted.entrepreneur / total) * 100,
    manager: (adjusted.manager / total) * 100,
    artisan: (adjusted.artisan / total) * 100,
  };
  const shares = roundToHundred(raw);
  return {
    entrepreneur: shares.entrepreneur,
    manager: shares.manager,
    artisan: shares.artisan,
    strengths,
    dominance_label: computeEmythDominanceLabel(strengths),
  };
}

// ─── DISC scoring ─────────────────────────────────────────────────────

/**
 * Compute DISC strengths (each 0-100, INDEPENDENT).
 * v2 question bank: Likert items per color, including reverse-keyed (since v3 questions add 1 reverse per color).
 * v1 legacy fallback: forced-choice items — preserved for backward compatibility on old in-flight submissions.
 */
export function computeDiscStrengths(
  answers: Answer[],
  reverseMap: Record<string, boolean>,
): DiscStrengths {
  const centered: Record<DiscColor, number> = { R: 0, Y: 0, G: 0, B: 0 };
  const counts: Record<DiscColor, number> = { R: 0, Y: 0, G: 0, B: 0 };

  let likertHits = 0;
  for (const a of answers) {
    if (!isLikert(a)) continue;
    if (!isDiscColor(a.axis)) continue;
    centered[a.axis] += centeredContribution(a, !!reverseMap[a.qid]);
    counts[a.axis] += 1;
    likertHits++;
  }

  if (likertHits > 0) {
    return {
      R: strengthFromCenteredSum(centered.R, counts.R),
      Y: strengthFromCenteredSum(centered.Y, counts.Y),
      G: strengthFromCenteredSum(centered.G, counts.G),
      B: strengthFromCenteredSum(centered.B, counts.B),
    };
  }

  // v1 fallback: forced-choice (only reached if the assessment was submitted under v1 questions).
  // Map most/least counts to a 0-100 strength per color using the same theoretical max as the original DISC bank.
  const fc: Record<DiscColor, { most: number; least: number }> = {
    R: { most: 0, least: 0 },
    Y: { most: 0, least: 0 },
    G: { most: 0, least: 0 },
    B: { most: 0, least: 0 },
  };
  let totalForced = 0;
  for (const a of answers) {
    if (!isForcedChoice(a)) continue;
    fc[a.most].most += 1;
    if (a.least) fc[a.least].least += 1;
    totalForced++;
  }
  if (totalForced === 0) return { R: 0, Y: 0, G: 0, B: 0 };
  const fcStrength = (most: number, least: number) =>
    Math.max(0, Math.min(100, Math.round(((most - least) / totalForced) * 100 + 25)));
  return {
    R: fcStrength(fc.R.most, fc.R.least),
    Y: fcStrength(fc.Y.most, fc.Y.least),
    G: fcStrength(fc.G.most, fc.G.least),
    B: fcStrength(fc.B.most, fc.B.least),
  };
}

/**
 * Compute the full v3 DISC score object: strengths (independent) plus shares (sum to 100).
 */
export function computeDiscScores(
  answers: Answer[],
  reverseMap: Record<string, boolean>,
): DiscScores {
  const strengths = computeDiscStrengths(answers, reverseMap);
  const adjusted = {
    R: strengths.R + SHARE_BASELINE,
    Y: strengths.Y + SHARE_BASELINE,
    G: strengths.G + SHARE_BASELINE,
    B: strengths.B + SHARE_BASELINE,
  };
  const total = adjusted.R + adjusted.Y + adjusted.G + adjusted.B;
  const raw = {
    R: (adjusted.R / total) * 100,
    Y: (adjusted.Y / total) * 100,
    G: (adjusted.G / total) * 100,
    B: (adjusted.B / total) * 100,
  };
  const shares = roundToHundred(raw);
  return {
    R: shares.R,
    Y: shares.Y,
    G: shares.G,
    B: shares.B,
    strengths,
  };
}

/**
 * Pick primary and secondary DISC colors from STRENGTHS (v3) — independent 0-100 values.
 * Secondary is set only if its strength is ≥ SECONDARY_STRENGTH_THRESHOLD.
 * Ties broken by canonical R→Y→G→B order.
 */
export function pickDiscPrimarySecondary(
  scores: DiscScores,
): { primary: DiscColor; secondary: DiscColor | null } {
  // Prefer v3 strengths when present; fall back to shares for v1 data.
  const source: Record<DiscColor, number> = scores.strengths
    ? { R: scores.strengths.R, Y: scores.strengths.Y, G: scores.strengths.G, B: scores.strengths.B }
    : { R: scores.R, Y: scores.Y, G: scores.G, B: scores.B };
  const usingStrengths = !!scores.strengths;
  const threshold = usingStrengths ? SECONDARY_STRENGTH_THRESHOLD : 20;

  const order: DiscColor[] = ['R', 'Y', 'G', 'B'];
  const sorted = (Object.entries(source) as [DiscColor, number][])
    .sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]));

  const [primary, primaryScore] = sorted[0];
  const [second, secondScore] = sorted[1];

  if (primaryScore === secondScore && primaryScore > 0) {
    return { primary, secondary: second };
  }
  return {
    primary,
    secondary: secondScore >= threshold ? second : null,
  };
}

// ─── dominance label ──────────────────────────────────────────────────

/**
 * Generate a human-readable Hebrew dominance label from E-Myth strengths.
 * Drives the hero title in the report (e.g. "יזם מובהק", "פרופיל מעורב יזם-מנהל").
 */
export function computeEmythDominanceLabel(strengths: EmythStrengths): string {
  const order: EmythAxis[] = ['EM', 'MN', 'AR'];
  const ranked = order
    .map((k) => ({ key: k, value: strengths[axisField(k)] }))
    .sort((a, b) => b.value - a.value || order.indexOf(a.key) - order.indexOf(b.key));

  const [top, second] = ranked;

  // Empty-signal: user answered too neutrally on everything.
  if (top.value < 30) {
    return 'פרופיל לא מובהק — מומלץ למלא שוב עם תשובות החלטיות יותר';
  }
  // Strong dominance: top is clearly ahead of second.
  if (top.value >= 50 && top.value >= 2 * Math.max(second.value, 1)) {
    return `${EMYTH_AXIS_NAMES_HE[top.key]} מובהק`;
  }
  // Mixed profile: top is meaningful but second is close behind.
  if (top.value >= 50 && second.value >= 40) {
    return `פרופיל מעורב ${EMYTH_AXIS_NAMES_HE[top.key]}-${EMYTH_AXIS_NAMES_HE[second.key]}`;
  }
  // Moderately leaning but no clear dominance.
  if (top.value >= 40) {
    return `נטייה ל${EMYTH_AXIS_NAMES_HE[top.key]}`;
  }
  return 'פרופיל מאוזן';
}

function axisField(k: EmythAxis): keyof EmythStrengths {
  return k === 'EM' ? 'entrepreneur' : k === 'MN' ? 'manager' : 'artisan';
}

// ─── helpers ──────────────────────────────────────────────────────────

/**
 * Round percentages so they sum to exactly 100 (largest-remainder method).
 */
function roundToHundred<T extends Record<string, number>>(raw: T): T {
  const entries = Object.entries(raw) as [keyof T, number][];
  const floored = entries.map(([k, v]) => [k, Math.floor(v), v - Math.floor(v)] as const);
  const used = floored.reduce((acc, [, f]) => acc + f, 0);
  const remaining = 100 - used;
  const sorted = [...floored].sort((a, b) => b[2] - a[2]);
  const out: Record<string, number> = {};
  for (const [k, f] of floored) out[k as string] = f;
  for (let i = 0; i < remaining; i++) {
    out[sorted[i % sorted.length][0] as string] += 1;
  }
  return out as T;
}

/**
 * Validate an answer set against the question bank. Returns null if valid, else an error code.
 */
export function validateAnswers(
  answers: Answer[],
  questions: Question[],
): string | null {
  if (!Array.isArray(answers)) return 'answers_not_array';
  const byQid = new Map(questions.map((q) => [q.qid, q]));
  if (answers.length !== questions.length) return 'wrong_count';

  const seen = new Set<string>();
  for (const a of answers) {
    if (!a || typeof a !== 'object') return 'invalid_answer_shape';
    const q = byQid.get(a.qid);
    if (!q) return `unknown_qid:${a.qid}`;
    if (seen.has(a.qid)) return `duplicate_qid:${a.qid}`;
    seen.add(a.qid);

    if (q.type === 'likert') {
      if (a.type !== 'likert') return `type_mismatch:${a.qid}`;
      if (a.axis !== q.axis) return `axis_mismatch:${a.qid}`;
      if (![1, 2, 3, 4, 5].includes(a.value)) return `value_out_of_range:${a.qid}`;
    } else {
      // forced_choice (legacy v1 — current bank doesn't include any)
      if (a.type !== 'forced_choice') return `type_mismatch:${a.qid}`;
      const valid: DiscColor[] = ['R', 'Y', 'G', 'B'];
      if (!valid.includes(a.most)) return `invalid_most:${a.qid}`;
      if (a.least !== undefined) {
        if (!valid.includes(a.least)) return `invalid_least:${a.qid}`;
        if (a.most === a.least) return `most_equals_least:${a.qid}`;
      }
    }
  }
  return null;
}

// Re-export label constants used by computeEmythDominanceLabel so consumers
// importing from this module can reach them without a second import.
export { EMYTH_AXIS_NAMES_HE, DISC_COLOR_NAMES_HE };
