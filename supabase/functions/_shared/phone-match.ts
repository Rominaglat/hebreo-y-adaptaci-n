// Resolving a customer to a profile from a phone number they gave over the
// phone/WhatsApp. No I/O — unit-tested here and imported by the external-api
// edge function.
//
// WHY SUFFIX MATCHING AND NOT NORMALIZATION TO E.164
// --------------------------------------------------
// `profiles.phone` is free text typed by an admin (ManageUsers.tsx) plus a CSV
// bulk-import path. There is no unique index and no normalization on write, and
// the roster is genuinely multi-country: Israel *and* Argentina, Chile, Colombia,
// Costa Rica, Mexico and Paraguay. A survey of the 104 live phone-bearing rows
// found numbers stored as `050-1234567`, `501234567`, `972…`, `+549…`,
// `5950981234546` (Paraguay, with the trunk 0 kept *after* the country code) and
// three rows of unclassifiable junk.
//
// Any "strip the country code, then compare" scheme needs a country-code table
// AND a per-country trunk-prefix rule, and the Paraguay row alone proves the
// stored data does not obey those rules. Comparing the *last N digits* needs
// neither: `+`, `00`, dashes, spaces, parens, the trunk `0`, the country code,
// Argentina's optional mobile `9`, Mexico's legacy `1` and Paraguay's stray `0`
// all either vanish in `toDigits` or fall off the LEFT end of the suffix. The
// thing every spelling of a number agrees on is its tail.
//
// THE ONE EXCEPTION: ARGENTINA'S LEGACY `15`
// ------------------------------------------
// Every noise element listed above is a PREFIX, which is why the suffix compare
// absorbs it for free. Argentina's old domestic mobile marker is not: it is
// written `0` + area code + `15` + subscriber, i.e. INFIXED between the area
// code and the number, so it shifts the tail instead of falling off it. It only
// happens to survive the compare when the area code is 2 digits (Buenos Aires
// `11`), because AR area+subscriber is always 10 digits — a 2-digit area leaves
// an 8-digit subscriber, which is exactly the 8-rung, so the `15` lands just
// outside the window. With a 3- or 4-digit area code (Cordoba `351`, `336`,
// `249` — 4 of the 9 Argentine rows in production) the `15` lands INSIDE the
// last-8 window and the lookup misses. `arLegacy15Variant()` below is therefore
// the single country-specific rule in this file, and it is applied only after
// the plain ladder has already come back empty, so it can never change an
// answer the suffix compare already found.

/**
 * Longest suffix we compare.
 *
 * 9 is the Israeli national significant number. It cannot be 10: `0501234567`
 * (national) and `972501234567` (E.164) agree on their last 9 digits
 * (`501234567`) but disagree on their last 10 (`0501234567` vs `1501234567`),
 * and 71 of the 104 stored numbers use exactly that 0-prefixed national form —
 * so a last-10 rule would fail the single most common lookup in the corpus.
 */
export const MATCH_DIGITS_MAX = 9;

/**
 * Shortest suffix we will ever accept.
 *
 * 8 is the Costa Rican NSN and the Israeli *landline* NSN — the only classes in
 * the corpus that cannot produce 9 digits, so without this rung they would be
 * unreachable. It is the floor because 8 is the shortest complete national
 * number present: against 200 000 generated Israeli-shaped numbers that are not
 * in the corpus, a floor of 8 produced 0 false matches, 7 produced 1 and 6
 * produced 13. Do not lower it.
 */
export const MATCH_DIGITS_MIN = 8;

export interface PhoneCandidate {
  id: string;
  /** profiles.phone — free text, may be null, may be junk. */
  phone: string | null;
  /** profiles.deleted_at. Absent/null means live. */
  deletedAt?: string | null;
}

export type PhoneMatchStatus =
  | 'matched'          // exactly one live profile
  | 'ambiguous'        // >1 live profile — caller must disambiguate
  | 'matched_deleted'  // only soft-deleted profiles matched
  | 'not_found'
  | 'invalid_input';   // fewer than MATCH_DIGITS_MIN digits

export interface PhoneMatchResult<C extends PhoneCandidate = PhoneCandidate> {
  status: PhoneMatchStatus;
  /** [] for not_found / invalid_input; every colliding row for 'ambiguous'. */
  matches: C[];
  /** Digit count of the query, for the error message. */
  queryDigits: number;
  /** Which rung fired (9 or 8), or null. Log this. */
  matchedOn: number | null;
}

/**
 * Strip to [0-9].
 *
 * A JSON caller may send the number unquoted (`"phone": 972501234567`), so a
 * number is accepted — but only a non-negative safe integer. Without that guard
 * `String(1e21)` is `'1e+21'`, whose digits are `121`, and `String(0.5)` is
 * `'0.5'` → `05`: exponent and fraction notation would silently become a
 * different phone number. Everything else (null, objects, booleans) → ''.
 */
export function toDigits(raw: unknown): string {
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw >= 0 ? String(raw) : '';
  }
  if (typeof raw !== 'string') return '';
  return raw.replace(/\D+/g, '');
}

/**
 * The comparison key: the last `n` digits, or null when there are fewer than n.
 *
 * Returning null (rather than the short string) is what stops a stored
 * `050-123` — 7 digits — from matching an 8-digit query on a padded compare.
 * `n` is range-checked because a caller passing 4 here would quietly turn the
 * whole lookup into a mass-collision machine.
 */
export function phoneKey(raw: string | null | undefined, n: number): string | null {
  if (!Number.isInteger(n) || n < MATCH_DIGITS_MIN || n > MATCH_DIGITS_MAX) {
    throw new Error(`phoneKey: n must be ${MATCH_DIGITS_MIN}..${MATCH_DIGITS_MAX}, got ${n}`);
  }
  const digits = toDigits(raw);
  return digits.length >= n ? digits.slice(-n) : null;
}

/** Cheap pre-check for the request validator, before any database round-trip. */
export function isMatchableInput(raw: unknown): boolean {
  return toDigits(raw).length >= MATCH_DIGITS_MIN;
}

/**
 * `0` + area code + `15` + subscriber — Argentina's legacy domestic mobile
 * spelling — rewritten to the plain national number the suffix compare can use.
 * Returns null for anything that is not exactly that shape.
 *
 * Deliberately strict, because this is the one place the file guesses at a
 * country's dialling plan:
 *   - the trunk `0` is REQUIRED, which alone excludes every E.164 spelling
 *     (`549…`, `54…`) and every 10-digit national number in the corpus;
 *   - area + subscriber must come to exactly 10 digits, the invariant length of
 *     an Argentine national number, so a 13-digit string that merely happens to
 *     contain `15` at the right offset does not qualify.
 * Together those force the input to be 12 or 13 digits AND to parse as a real
 * AR number, so no Israeli, Chilean, Colombian, Mexican, Costa Rican or
 * Paraguayan spelling in the roster can reach this rewrite.
 */
function arLegacy15Variant(digits: string): string | null {
  const m = /^0(\d{2,4})15(\d{6,8})$/.exec(digits);
  if (!m) return null;
  const national = m[1] + m[2];
  return national.length === 10 ? national : null;
}

/**
 * Every digit-string `matchPhone` may compare against a candidate, in the order
 * it tries them: the query itself, plus the Argentine legacy-15 rewrite when the
 * query has that shape. Empty when the query is too short to look up at all.
 *
 * Exported for callers that narrow the candidate set in SQL before calling
 * `matchPhone`. The narrowing has to cover EVERY variant, otherwise the rewrite
 * can only find a row the database happened to return anyway — the query's own
 * digits are not a reliable filter for the rewritten form, because the deleted
 * `15` sits in the middle.
 */
export function matchQueryVariants(query: unknown): string[] {
  const digits = toDigits(query);
  if (digits.length < MATCH_DIGITS_MIN) return [];
  const arNational = arLegacy15Variant(digits);
  return arNational ? [digits, arNational] : [digits];
}

/**
 * One pass of the two-rung ladder over `digits`.
 *
 * Returns null when no rung hit anything at all, so the caller can decide
 * whether it is worth retrying with a rewritten query. STOPS on the first rung
 * that hits: stopping early is what lets the loose 8-rung exist without costing
 * precision, since a number that resolves at 9 is never re-opened to the extra
 * neighbours an 8-digit compare would drag in.
 */
function runLadder<C extends PhoneCandidate>(
  digits: string,
  candidates: readonly C[],
): Omit<PhoneMatchResult<C>, 'queryDigits'> | null {
  const top = Math.min(MATCH_DIGITS_MAX, digits.length);

  for (let n = top; n >= MATCH_DIGITS_MIN; n--) {
    const key = digits.slice(-n);
    const hits = candidates.filter((c) => phoneKey(c.phone, n) === key);
    if (hits.length === 0) continue;

    const live = hits.filter((c) => !c.deletedAt);
    if (live.length === 1) return { status: 'matched', matches: live, matchedOn: n };
    if (live.length > 1) return { status: 'ambiguous', matches: live, matchedOn: n };
    return { status: 'matched_deleted', matches: hits, matchedOn: n };
  }

  return null;
}

/**
 * Resolve a caller-supplied phone number to a profile. Pure — no I/O, no clock.
 *
 * Walks a two-rung ladder, 9 digits then 8, and STOPS on the first rung that
 * hits anything at all (see runLadder).
 *
 * Only if that comes back empty, and only for the one spelling the suffix
 * compare provably cannot absorb — Argentina's infixed legacy `15` — the ladder
 * is run a second time on the rewritten number. That retry is strictly
 * additive: it can turn a `not_found` into an answer and nothing else, so every
 * outcome the plain ladder already produced is untouched.
 *
 * Live profiles beat soft-deleted ones inside a rung, so a deleted duplicate of
 * a live account reads as `matched`, not `ambiguous`.
 *
 * Ambiguity is a TERMINAL STATE, never a tie-break. Four buckets in production
 * are genuinely ambiguous — two are two different people sharing one handset,
 * two are one person with duplicate accounts — covering 8 profiles. Picking one
 * would report the wrong customer's inactivity; the caller has to disambiguate
 * by user_id, or an admin has to fix the data.
 */
export function matchPhone<C extends PhoneCandidate>(
  query: unknown,
  candidates: readonly C[],
): PhoneMatchResult<C> {
  const queryDigits = toDigits(query);
  if (queryDigits.length < MATCH_DIGITS_MIN) {
    return { status: 'invalid_input', matches: [], queryDigits: queryDigits.length, matchedOn: null };
  }

  // The query itself first, then the legacy-15 rewrite if it applies. Driven by
  // the same matchQueryVariants() the SQL narrowing uses, so the two cannot
  // drift apart and leave the rewrite looking for a row the database filtered
  // out. A short query can only start on the rung it can actually fill; a long
  // one (E.164, or a caller who pasted a 00 prefix) starts at the 9-digit
  // ceiling — runLadder handles both.
  for (const digits of matchQueryVariants(query)) {
    const hit = runLadder(digits, candidates);
    if (hit) return { ...hit, queryDigits: queryDigits.length };
  }

  return { status: 'not_found', matches: [], queryDigits: queryDigits.length, matchedOn: null };
}
