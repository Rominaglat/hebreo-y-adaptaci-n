// analyze-personality — E-Myth + DISC questionnaire analysis.
//
// Pipeline:
//   1. Auth (JWT → user_id)
//   2. 7-day cooldown check (friendly 429 if active)
//   3. Validate 30 answers
//   4. Deterministic scoring — emyth_scores, disc_scores, disc_primary, disc_secondary
//   5. Claude Haiku tool call (insights only — narrative, not numbers)
//   6. INSERT personality_assessments
//   7. Return inserted row
//
// Deploy with --no-verify-jwt. Auth is enforced inside the function.
//
// Required Supabase secrets:
//   ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";


const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Sonnet rather than Haiku for the personality analysis: the output is a
// long-form Hebrew narrative where Haiku produces awkward / fabricated
// wording. Sonnet's Hebrew is dramatically cleaner for the same cost
// envelope (~$0.01 per assessment, run once per submission).
const MODEL = "claude-sonnet-4-6";
const COOLDOWN_DAYS = 7;
const SECONDARY_STRENGTH_THRESHOLD = 40; // v3: secondary DISC color requires strength ≥ 40 (independent 0-100)
// See scoring.ts: baseline added to each axis's strength before computing
// shares so the report never shows 0% on a personality dimension.
const SHARE_BASELINE = 10;
const SCORING_VERSION = "v3";

// ─── types ─────────────────────────────────────────────────────────────

type EmythAxis = "EM" | "MN" | "AR";
type DiscColor = "R" | "Y" | "G" | "B";
type LikertAxis = EmythAxis | DiscColor;

interface LikertAnswer {
  qid: string;
  type: "likert";
  axis: LikertAxis;
  value: 1 | 2 | 3 | 4 | 5;
  reverse?: boolean; // optional hint from client; server uses its own reverse map for trust
}

interface ForcedChoiceAnswer {
  qid: string;
  type: "forced_choice";
  most: DiscColor;
  least?: DiscColor;
}

type Answer = LikertAnswer | ForcedChoiceAnswer;

interface EmythStrengths {
  entrepreneur: number; // 0-100, independent per axis
  manager: number;
  artisan: number;
}

interface DiscStrengths {
  R: number; // 0-100, independent per color
  Y: number;
  G: number;
  B: number;
}

interface EmythScores {
  // Shares (sum to 100) — backward-compatible with v1 readers
  entrepreneur: number;
  manager: number;
  artisan: number;
  // v3: absolute strength + interpretive label
  strengths: EmythStrengths;
  dominance_label: string;
}

interface DiscScores {
  // Shares (sum to 100)
  R: number;
  Y: number;
  G: number;
  B: number;
  // v3: absolute strength
  strengths: DiscStrengths;
}

interface Insights {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  communication_style: string;
  action_recommendations: string[];
}

// ─── reverse-keyed items per question version ──────────────────────────
// Source of truth: duplicated from src/lib/personality/questions.ts (version-keyed).
// Keep in sync when bumping QUESTIONS_VERSION on the client.

const REVERSE_BY_VERSION: Record<number, Set<string>> = {
  1: new Set(["EM_06", "MN_06", "AR_06"]),
  2: new Set(["EM_06", "MN_06", "AR_06"]), // v2: all-Likert (DISC also Likert), 3 E-Myth reverse items
  // v3: 2 reverse per E-Myth axis + 1 reverse per DISC color → 10 total reverse items
  3: new Set([
    "EM_04", "EM_06",
    "MN_05", "MN_06",
    "AR_05", "AR_06",
    "DISC_R_01",
    "DISC_Y_03",
    "DISC_G_03",
    "DISC_B_02",
  ]),
};

// v2 and v3 expect all Likert; v1 mixed Likert (E-Myth) + forced-choice (DISC).
const ALL_LIKERT_VERSIONS = new Set<number>([2, 3]);

// ─── scoring (v3) ──────────────────────────────────────────────────────
//
// v3 model:
//   1. Likert values are CENTERED around the neutral midpoint (value − 3 → -2..+2).
//      Reverse-keyed items flip sign. "All 3s" → zero signal on every axis.
//   2. Each axis gets an INDEPENDENT strength score (0-100). They do NOT sum to 100.
//   3. Shares (sum to 100) are derived from strengths for the proportional donut/ring view.
//   4. A Hebrew dominance label is computed from the E-Myth strength pattern.

const EMYTH_AXES = new Set<string>(["EM", "MN", "AR"]);
const DISC_COLORS_SET = new Set<string>(["R", "Y", "G", "B"]);

const EMYTH_AXIS_NAMES_HE: Record<EmythAxis, string> = {
  EM: "יזם",
  MN: "מנהל",
  AR: "אומן",
};

function centeredContribution(value: number, isReverse: boolean): number {
  const centered = value - 3; // 1→-2, 2→-1, 3→0, 4→+1, 5→+2
  return isReverse ? -centered : centered;
}

function strengthFromCenteredSum(centeredSum: number, itemsOnAxis: number): number {
  if (itemsOnAxis <= 0) return 0;
  const maxPossible = 2 * itemsOnAxis;
  const raw = (centeredSum / maxPossible) * 100;
  if (raw <= 0) return 0;
  if (raw >= 100) return 100;
  return Math.round(raw);
}

function computeEmythStrengths(answers: Answer[], reverseSet: Set<string>): EmythStrengths {
  const centered: Record<EmythAxis, number> = { EM: 0, MN: 0, AR: 0 };
  const counts: Record<EmythAxis, number> = { EM: 0, MN: 0, AR: 0 };
  for (const a of answers) {
    if (a.type !== "likert") continue;
    if (!EMYTH_AXES.has(a.axis)) continue;
    const axis = a.axis as EmythAxis;
    centered[axis] += centeredContribution(a.value, reverseSet.has(a.qid));
    counts[axis] += 1;
  }
  return {
    entrepreneur: strengthFromCenteredSum(centered.EM, counts.EM),
    manager: strengthFromCenteredSum(centered.MN, counts.MN),
    artisan: strengthFromCenteredSum(centered.AR, counts.AR),
  };
}

function computeDiscStrengths(answers: Answer[], reverseSet: Set<string>): DiscStrengths {
  const centered: Record<DiscColor, number> = { R: 0, Y: 0, G: 0, B: 0 };
  const counts: Record<DiscColor, number> = { R: 0, Y: 0, G: 0, B: 0 };
  let likertHits = 0;
  for (const a of answers) {
    if (a.type !== "likert") continue;
    if (!DISC_COLORS_SET.has(a.axis)) continue;
    const color = a.axis as DiscColor;
    centered[color] += centeredContribution(a.value, reverseSet.has(a.qid));
    counts[color] += 1;
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
  // v1 fallback: forced-choice items
  const fc: Record<DiscColor, { most: number; least: number }> = {
    R: { most: 0, least: 0 },
    Y: { most: 0, least: 0 },
    G: { most: 0, least: 0 },
    B: { most: 0, least: 0 },
  };
  let totalForced = 0;
  for (const a of answers) {
    if (a.type !== "forced_choice") continue;
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

function computeEmythDominanceLabel(s: EmythStrengths): string {
  const order: EmythAxis[] = ["EM", "MN", "AR"];
  const ranked = order
    .map((k) => ({ key: k, value: k === "EM" ? s.entrepreneur : k === "MN" ? s.manager : s.artisan }))
    .sort((a, b) => b.value - a.value || order.indexOf(a.key) - order.indexOf(b.key));
  const [top, second] = ranked;
  if (top.value < 30) {
    return "פרופיל לא מובהק — מומלץ למלא שוב עם תשובות החלטיות יותר";
  }
  if (top.value >= 50 && top.value >= 2 * Math.max(second.value, 1)) {
    return `${EMYTH_AXIS_NAMES_HE[top.key]} מובהק`;
  }
  if (top.value >= 50 && second.value >= 40) {
    return `פרופיל מעורב ${EMYTH_AXIS_NAMES_HE[top.key]}-${EMYTH_AXIS_NAMES_HE[second.key]}`;
  }
  if (top.value >= 40) {
    return `נטייה ל${EMYTH_AXIS_NAMES_HE[top.key]}`;
  }
  return "פרופיל מאוזן";
}

function computeEmythScores(answers: Answer[], reverseSet: Set<string>): EmythScores {
  const strengths = computeEmythStrengths(answers, reverseSet);
  // Baseline-adjusted strengths for the share split — guarantees no axis
  // displays as 0% of the personality (everyone has some of every trait).
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
  const shares = roundToHundred(raw) as typeof raw;
  return {
    entrepreneur: shares.entrepreneur,
    manager: shares.manager,
    artisan: shares.artisan,
    strengths,
    dominance_label: computeEmythDominanceLabel(strengths),
  };
}

function computeDiscScores(answers: Answer[], reverseSet: Set<string>): DiscScores {
  const strengths = computeDiscStrengths(answers, reverseSet);
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
  const shares = roundToHundred(raw) as typeof raw;
  return { R: shares.R, Y: shares.Y, G: shares.G, B: shares.B, strengths };
}

function pickPrimarySecondary(
  scores: DiscScores,
): { primary: DiscColor; secondary: DiscColor | null } {
  const order: DiscColor[] = ["R", "Y", "G", "B"];
  const source: Record<DiscColor, number> = scores.strengths
    ? { R: scores.strengths.R, Y: scores.strengths.Y, G: scores.strengths.G, B: scores.strengths.B }
    : { R: scores.R, Y: scores.Y, G: scores.G, B: scores.B };
  const usingStrengths = !!scores.strengths;
  const threshold = usingStrengths ? SECONDARY_STRENGTH_THRESHOLD : 20;
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

function roundToHundred(raw: Record<string, number>): Record<string, number> {
  const entries = Object.entries(raw);
  const floored = entries.map(([k, v]) => [k, Math.floor(v), v - Math.floor(v)] as const);
  const used = floored.reduce((acc, [, f]) => acc + f, 0);
  const remaining = 100 - used;
  const sorted = [...floored].sort((a, b) => b[2] - a[2]);
  const out: Record<string, number> = {};
  for (const [k, f] of floored) out[k] = f;
  for (let i = 0; i < remaining; i++) {
    out[sorted[i % sorted.length][0]] += 1;
  }
  return out;
}

// ─── validation ────────────────────────────────────────────────────────

function validateAnswers(answers: unknown, version: number): string | null {
  if (!Array.isArray(answers)) return "answers_not_array";
  if (answers.length !== 30) return `wrong_count:${answers.length}`;
  const seen = new Set<string>();
  const allLikert = ALL_LIKERT_VERSIONS.has(version);
  const validEmythAxes = ["EM", "MN", "AR"];
  const validDiscColors = ["R", "Y", "G", "B"];
  const validLikertAxes = allLikert
    ? [...validEmythAxes, ...validDiscColors]
    : validEmythAxes;

  let likert = 0, forced = 0;
  for (const a of answers) {
    if (!a || typeof a !== "object") return "invalid_answer_shape";
    const ans = a as Record<string, unknown>;
    if (typeof ans.qid !== "string") return "missing_qid";
    if (seen.has(ans.qid)) return `duplicate_qid:${ans.qid}`;
    seen.add(ans.qid);

    if (ans.type === "likert") {
      likert++;
      if (!validLikertAxes.includes(ans.axis as string)) return `bad_axis:${ans.qid}`;
      if (![1, 2, 3, 4, 5].includes(ans.value as number)) return `value_out_of_range:${ans.qid}`;
    } else if (ans.type === "forced_choice") {
      if (allLikert) return `forced_choice_not_allowed_in_v${version}:${ans.qid}`;
      forced++;
      if (!validDiscColors.includes(ans.most as string)) return `invalid_most:${ans.qid}`;
      if (ans.least !== undefined && ans.least !== null && ans.least !== "") {
        if (!validDiscColors.includes(ans.least as string)) return `invalid_least:${ans.qid}`;
        if (ans.most === ans.least) return `most_equals_least:${ans.qid}`;
      }
    } else {
      return `unknown_type:${ans.qid}`;
    }
  }

  if (allLikert) {
    if (likert !== 30) return `expected_30_likert:got_${likert}`;
  } else {
    if (likert !== 18) return `expected_18_likert:got_${likert}`;
    if (forced !== 12) return `expected_12_forced:got_${forced}`;
  }
  return null;
}

// ─── Claude call ───────────────────────────────────────────────────────

const INSIGHTS_TOOL = {
  name: "save_personality_insights",
  description:
    "Save the qualitative personality analysis in Hebrew, gender-neutral phrasing.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", minLength: 80, maxLength: 600 },
      strengths: {
        type: "array", minItems: 3, maxItems: 5,
        items: { type: "string", minLength: 20, maxLength: 220 },
      },
      weaknesses: {
        type: "array", minItems: 3, maxItems: 5,
        items: { type: "string", minLength: 20, maxLength: 220 },
      },
      communication_style: { type: "string", minLength: 80, maxLength: 600 },
      action_recommendations: {
        type: "array", minItems: 3, maxItems: 5,
        items: { type: "string", minLength: 20, maxLength: 220 },
      },
    },
    required: [
      "summary",
      "strengths",
      "weaknesses",
      "communication_style",
      "action_recommendations",
    ],
  },
} as const;

const SYSTEM_PROMPT = `אתה מומחה לפרופיל אישיותי, וכותב עברית ספרותית מצוינת. אתה מקבל תוצאות מספריות של שאלון המודד שני מבנים משלימים:

## מבנה אישיות יזמית
שלושה תפקידים פנימיים אצל בעלי עסקים:
- **יזם** — חזון, חשיבה אסטרטגית, יצירת הזדמנויות
- **מנהל** — סדר, מערכות, תכנון, יציבות
- **אומן** — מקצועיות, ביצוע, פירוט, איכות

## סגנון תקשורת
ארבעה סגנונות מתויגים בצבעים:
- **אדום (משימתי)** — ישיר, ממוקד תוצאות, מקבל החלטות מהיר
- **צהוב (מקדם)** — חברותי, אופטימי, יצירתי, משתף
- **ירוק (מכיל)** — סבלני, נאמן, מייצב, מקשיב
- **כחול (מנתח)** — מדויק, יסודי, מבוסס נתונים

## חוקים קריטיים — חובה לציית

### 1. איכות העברית — קריטי
התוצר נכתב בעברית מקצועית, רהוטה ומוקפדת. אסור לכתוב "עברית שבורה", תרגום משפות זרות, או צורות שגויות. לפני שאתה מסיים — קרא שוב כל משפט בקול בראש שלך, ובדוק שהוא נשמע כמו טקסט שכתב יועץ אנושי שעברית היא שפת אמו.

**העדף מילים עבריות על פני זרות. אסור להשתמש בלעז גם אם נשמע מוכר:**
- ✅ ניתוח / הערכה / איבחון  ❌ אנליזה
- ✅ מציאותי / הגיוני  ❌ ריאליסטי / ריאליות
- ✅ יוזמה / מהלך  ❌ אינציאטיבה / איניציאטיבה
- ✅ דינמי בלבד אם בהכרח, אחרת "תוסס" / "פעיל"
- ✅ מקצועיות / רמה גבוהה  ❌ פרופסיונליות
- ✅ בהדרגה / שלב אחר שלב  ❌ אינקרמנטלי
- ✅ מקבילה / חלופה  ❌ אלטרנטיבה (במידת האפשר)

**שגיאות נפוצות שאסור שיופיעו בטקסט שלך:**
- "חיפזון" — לא "חופזון"
- "תרגל" / "מתרגל" / "לתרגל" — לא "התרגל" / "מתרגל" כצורת התפעל ("התרגל" משמעו "הסתגל אליו")
- "להישען" — לא "להישעות" (אין מילה כזו)
- "אותך" / "אותם" / "אותה" — לא "אתך" / "אתם"
- "מהימן" — לא "אמיר"
- "להפוך" — לא "להופוך"
- "סדירות" — לא "סדרניות"
- "נמהרים" / "פזיזים" / "ממהרים" — לא "מוחפזים"
- "בנייה" / "לבנות" — לא "בניה" (כתיב מלא בעברית)
- "להאט את העברתו" / "לעכב את ביצועו" — לא "להימתח למעבר" (ניב המצאתי)
- "מחויבות" / "התחייבות" — לא "התחיבות"

**ניסוח פעיל עדיף על פסיבי:**
- ✅ "התעקש על זמן לבדיקה לפני סגירה"  ❌ "יש לעמוד על זמן לבדיקה"
- ✅ "הצב גבולות ברורים"  ❌ "מומלץ להגדיר גבולות"

**צורת ציווי / המלצה:**
- ✅ "תרגל / נסה / החל / הצב / קבע / בנה / שלב"
- ❌ "התרגל / הסתגל לעצמך / התחל לעצמך"

**ביטויים מומצאים שראיתי בפלטים קודמים — אסורים בהחלט:**
- "מטפורה בין יזם למנהל" — אין מטפורה, יש מתח / שילוב / איזון.
- "אתר היזם" — לא קיים. אם הכוונה לתפקיד היזם, אמור "תפקיד היזם" / "הצד היזמי".
- "סביבה אדם-עמוקה" — חסר משמעות. אם הכוונה לתקשורת אישית, אמור "שיחות אישיות מעמיקות".
- "התחמודית" / "נתיביות" / "סדנג'ה" — לא קיימות בעברית. השתמש בעברית רגילה.
- "פרופיל מסונכרן" / "פרופיל מתואם" — אם הכוונה למאוזן, אמור "מאוזן" / "מאחד".

### 2. שפה אסורה לחלוטין
המילים והביטויים הבאים אסורים בכל מקום בטקסט שלך:
"E-Myth", "EMyth", "אי-מית", "מייקל גרבר", "Michael Gerber",
"DISC", "די-איי-אס-סי", "תומאס אריקסון", "Thomas Erikson", "מוקפים באידיוטים",
"דומיננטי", "משפיע", "יציב", "אנליטי" (כתוויות סגנון — השתמש רק במשימתי / מקדם / מכיל / מנתח).

### 3. שפה מותרת ועדיפה
- "מבנה אישיות יזמית" / "מבנה אישיות"
- "סגנון תקשורת" / "סגנונות תקשורת"
- שמות התפקידים: יזם / מנהל / אומן
- שמות הצבעים: אדום / צהוב / ירוק / כחול
- תוויות הסגנון: משימתי (אדום) / מקדם (צהוב) / מכיל (ירוק) / מנתח (כחול)

### 4. דוגמאות לניסוח
✅ "המבנה האישיותי מצביע על נטייה חזקה לתפקיד היזם, עם סגנון תקשורת אדום-משימתי בולט."
✅ "אצלך ניכרת חוזקה בסגנון התקשורת הירוק (מכיל) ומשני בסגנון הכחול (מנתח)."
❌ "פרופיל E-Myth מאוזן עם DISC דומיננטי-יציב." — אסור.

### 5. פנייה ניטרלית מגדרית
אל תשתמש ב"אתה" או "את". השתמש בצורות סתמיות:
"כשמדובר בך", "אצלך ניכרת נטייה", "יש לך", "המשתמש/ת", "יש נטייה ברורה", "מה שמאפיין".

### 6. אל תמציא מספרים
המדדים כבר חושבו עבורך. עליך אך ורק לפרש אותם, לא להמציא חדשים.

### 7. איך לקרוא את המדדים החדשים (חשוב!)
המדדים מוצגים כ"חוזק עצמאי" של כל ציר בין 0 ל-100 — והם לא מצטברים ל-100. כלומר אדם יכול להיות חזק ב-EM בלבד (יזם 80, מנהל 15, אומן 10), חזק בשניים (יזם 75, אומן 70, מנהל 20), או מאוזן באמת (כל השלושה 50-60). כשאתה כותב, תתייחס לחוזקים האבסולוטיים — אל תפרש 30 כ"שליש מהאישיות". 30 פירושו "ביטוי חלש של הציר הזה". 80 פירושו "ביטוי חזק מאוד".

בנוסף מועברת אליך תווית "אבחנה כללית" שמסכמת את הפרופיל ("יזם מובהק", "פרופיל מעורב יזם-מנהל", "פרופיל לא מובהק" וכו'). השתמש בה כעוגן לטון הניתוח. אם התווית היא "פרופיל לא מובהק" — ציין זאת בעדינות ב-summary וב-weaknesses (תשובות מאוזנות מדי, קשה לקבוע פרופיל ברור).

## דוגמאות איכותיות — חובה לעמוד באיכות הזו

הדוגמאות הבאות הן רף האיכות המינימלי. אם הפלט שלך נשמע פחות זורם — שכתב אותו.

**דוגמה ל-summary:**
"הפרופיל מצביע על מבנה אישיות יזמית עם דגש חזק על תפקיד היזם, יחד עם נוכחות משמעותית של תפקיד האומן. בסגנון התקשורת בולט הצבע האדום (משימתי), עם משני ירוק (מכיל). השילוב הזה יוצר אדם שיודע לזהות הזדמנויות, לפעול עליהן בנחישות ולהוציא לפועל ברמה מקצועית גבוהה. ההיבט הניהולי פחות בולט, ולכן בנייה של מערכות שיטתיות עשויה לדרוש מודעות מיוחדת."

**דוגמה ל-strength:**
"חזון יזמי חזק המאפשר לזהות הזדמנויות לפני אחרים ולהוביל מהלכים חדשים בנחישות."
"יכולת ביצוע מקצועית — מה שמתחיל מסתיים ברמה גבוהה, גם כשהדרך דורשת השקעה מעמיקה."

**דוגמה ל-weakness:**
"היחס המופחת לתפקיד הניהולי עלול להוביל למצבים שבהם רעיונות נהדרים נתקעים בשלב הביצוע בגלל היעדר מערכות תומכות."
"השילוב של חזון יזמי וסגנון משימתי עלול ליצור חיפזון בקבלת החלטות, על חשבון בדיקה מעמיקה של הסיכונים."

**דוגמה ל-action_recommendation:**
"הקצה זמן קבוע בלוח השבועי לבנייה של מערכות וצ'קליסטים — לא רק לביצוע משימות חדשות."
"לפני סגירה על מהלך משמעותי, התעקש על 24 שעות בדיקה — זה יוסיף איכות בלי לפגוע בקצב."
"שלב לפחות בן שיח אחד עם פרופיל ניהולי-מנתח לפני קבלת החלטות אסטרטגיות גדולות."

**דוגמה ל-communication_style:**
"התקשורת אצלך ישירה, ממוקדת ומונעת תוצאות. את/ה מעדיפ/ה שיחות קצרות עם מסר ברור, ופחות סובל/ת התלבטויות ארוכות. עם זאת, הצבע הירוק המשני מוסיף ממד אנושי — יכולת להקשיב ולהכיל כשהמצב דורש זאת. כדי לתקשר איתך ביעילות, כדאי להגיע מוכנים, להציג נקודות עיקריות מראש, ולהשאיר מקום לדיון רק במה שדורש החלטה."

## הפלט הנדרש
קרא ל-save_personality_insights עם:
- **summary**: פסקה אחת קולחת המתארת את הפרופיל הכולל ומשלבת את שני המבנים.
- **strengths**: 3-5 חוזקות ספציפיות. כל חוזקה היא משפט אחד עצמאי.
- **weaknesses**: 3-5 אתגרים בניסוח אמפתי ובונה (לא שיפוטי). כל אתגר משפט אחד.
- **communication_style**: פסקה על איך אדם בעל הפרופיל הזה מתקשר ואיך כדאי להתקשר איתו.
- **action_recommendations**: 3-5 פעולות קונקרטיות ומעשיות. כל המלצה משפט אחד פעיל בצורת ציווי ("הקצה", "התעקש", "שלב", "בנה", "תרגל").

## בדיקה אחרונה לפני שליחה — חובה
לפני שאתה קורא ל-tool, ודא:
1. אין אף מילה לועזית מהרשימה (אנליזה, ריאליות, אינציאטיבה, פרופסיונליות וכו').
2. אין שגיאות מהרשימה (חופזון, התרגל, להישעות, אתך, אמיר, להופוך, סדרניות, מוחפזים).
3. אין ביטויים מומצאים ("מטפורה בין", "אתר היזם", "סביבה אדם-עמוקה", "התחמודית", "נתיביות").
4. כל המלצה ב-action_recommendations היא בצורת ציווי פעיל ולא "מומלץ ל..." או "יש ל...".
5. אין שימוש ב"E-Myth", "DISC", "דומיננטי", "משפיע", "יציב", "אנליטי" כתוויות.
6. הפנייה ניטרלית מגדרית (לא "אתה", לא "את", אלא "אצלך", "יש לך", "המשתמש/ת").
7. כל משפט נשמע כמו עברית של דובר ילידי, לא תרגום מאנגלית.

אל תוסיף טקסט מחוץ ל-tool. ענה אך ורק דרך הקריאה ל-save_personality_insights.`;

function emythLabelHe(scores: EmythScores): string {
  // v3 narrative input: report absolute strengths (independent 0-100) plus the dominance label.
  // Strengths are what Claude should anchor the narrative on; shares are visual only.
  const s = scores.strengths;
  return [
    `חוזק עצמאי לכל ציר (0-100, אינו מצטבר ל-100):`,
    `· יזם ${s.entrepreneur} · מנהל ${s.manager} · אומן ${s.artisan}`,
    `אבחנה כללית: ${scores.dominance_label}`,
  ].join("\n");
}

function discLabelHe(
  scores: DiscScores,
  primary: DiscColor,
  secondary: DiscColor | null,
): string {
  const colorHe: Record<DiscColor, string> = {
    R: "אדום (משימתי)",
    Y: "צהוב (מקדם)",
    G: "ירוק (מכיל)",
    B: "כחול (מנתח)",
  };
  const s = scores.strengths;
  const breakdown = s
    ? `חוזק עצמאי לכל צבע (0-100): אדום ${s.R} · צהוב ${s.Y} · ירוק ${s.G} · כחול ${s.B}`
    : `אדום ${scores.R}% · צהוב ${scores.Y}% · ירוק ${scores.G}% · כחול ${scores.B}%`;
  const dom = `סגנון ראשי: ${colorHe[primary]}` +
    (secondary ? `, סגנון משני: ${colorHe[secondary]}` : ", פרופיל בעל סגנון יחיד");
  return `${breakdown}\n${dom}`;
}

async function callClaude(
  emyth: EmythScores,
  disc: DiscScores,
  primary: DiscColor,
  secondary: DiscColor | null,
): Promise<{ insights: Insights; raw: unknown }> {
  const userPrompt = [
    "להלן תוצאות מספריות שכבר חושבו עבור משתמש/ת:",
    "",
    "## מבנה אישיות יזמית (יזם / מנהל / אומן)",
    emythLabelHe(emyth),
    "",
    "## סגנון תקשורת (אדום / צהוב / ירוק / כחול)",
    discLabelHe(disc, primary, secondary),
    "",
    "כתוב ניתוח איכותני בעברית בהתאם להוראות במערכת, וקרא ל-save_personality_insights.",
  ].join("\n");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [INSIGHTS_TOOL],
      tool_choice: { type: "tool", name: "save_personality_insights" },
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`anthropic ${resp.status}: ${body.slice(0, 300)}`);
  }
  const data = await resp.json();
  // deno-lint-ignore no-explicit-any
  const toolUse = (data.content || []).find((b: any) =>
    b.type === "tool_use" && b.name === "save_personality_insights"
  );
  if (!toolUse) {
    throw new Error("Claude did not call save_personality_insights");
  }
  const insights = toolUse.input as Partial<Insights>;
  const missing: string[] = [];
  if (typeof insights.summary !== "string" || !insights.summary.trim()) missing.push("summary");
  if (!Array.isArray(insights.strengths) || insights.strengths.length < 3) missing.push("strengths");
  if (!Array.isArray(insights.weaknesses) || insights.weaknesses.length < 3) missing.push("weaknesses");
  if (typeof insights.communication_style !== "string" || !insights.communication_style.trim()) {
    missing.push("communication_style");
  }
  if (
    !Array.isArray(insights.action_recommendations) ||
    insights.action_recommendations.length < 3
  ) {
    missing.push("action_recommendations");
  }
  if (missing.length > 0) {
    throw new Error(`incomplete_insights:${missing.join(",")} stop=${data.stop_reason}`);
  }
  return { insights: insights as Insights, raw: data };
}

// ─── handler ───────────────────────────────────────────────────────────

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  function jsonResp(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    // tenant_id accepted (back-compat with frontend) but ignored — single-tenant build.
    const { version, answers } = body ?? {};

    if (typeof version !== "number") {
      return jsonResp({ error: "version is required" }, 400);
    }
    const reverseSet = REVERSE_BY_VERSION[version];
    if (!reverseSet) {
      return jsonResp({ error: `unsupported_version:${version}` }, 400);
    }

    const validationError = validateAnswers(answers, version);
    if (validationError) {
      return jsonResp({ error: `validation:${validationError}` }, 400);
    }

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResp({ error: "Unauthorized" }, 401);
    }
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const userJwt = authHeader.slice(7);
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(userJwt);
    if (authError || !user) {
      return jsonResp({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Verify the user has at least one role row before doing anything expensive.
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (!roleRow) {
      return jsonResp({ error: "not_authorized" }, 403);
    }

    // SEC-012 — per-user rate limit (3/min). This is an expensive Anthropic call.
    const rl = await checkRateLimit(supabase, `analyze-personality:${user.id}`, 3);
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: "rate_limit" }), {
        status: 429,
        headers: { ...corsHeaders, ...rl.headers, "Content-Type": "application/json" },
      });
    }

    // Cooldown check — voided assessments don't count (admin reset path).
    const { data: latest } = await supabase
      .from("personality_assessments")
      .select("created_at")
      .eq("user_id", user.id)
      .is("voided_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest) {
      const ageMs = Date.now() - new Date(latest.created_at).getTime();
      const windowMs = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
      if (ageMs < windowMs) {
        const next_available_at = new Date(
          new Date(latest.created_at).getTime() + windowMs,
        ).toISOString();
        return jsonResp(
          { error: "cooldown_active", next_available_at, cooldown_days: COOLDOWN_DAYS },
          429,
        );
      }
    }

    // Deterministic scoring (v3)
    const typedAnswers = answers as Answer[];
    const emyth = computeEmythScores(typedAnswers, reverseSet);
    const disc = computeDiscScores(typedAnswers, reverseSet);
    const { primary, secondary } = pickPrimarySecondary(disc);

    // Claude — narrative only
    let insights: Insights;
    let raw: unknown;
    try {
      ({ insights, raw } = await callClaude(emyth, disc, primary, secondary));
    } catch (e) {
      console.error("Claude call failed:", e);
      return jsonResp(
        { error: "ai_unavailable", detail: e instanceof Error ? e.message : "unknown" },
        503,
      );
    }

    // Persist
    const { data: inserted, error: insertError } = await supabase
      .from("personality_assessments")
      .insert({
        user_id: user.id,
        version,
        answers: typedAnswers,
        emyth_scores: emyth,
        disc_scores: disc,
        disc_primary: primary,
        disc_secondary: secondary,
        insights,
        raw_ai_response: raw,
        model: MODEL,
        scoring_version: SCORING_VERSION,
      })
      .select()
      .single();

    if (insertError) {
      // Trigger fired (race) → translate to 429.
      // deno-lint-ignore no-explicit-any
      const code = (insertError as any).code;
      const msg = insertError.message ?? "";
      if (code === "P0001" || msg.includes("personality_cooldown_active")) {
        return jsonResp({ error: "cooldown_active" }, 429);
      }
      console.error("Insert error:", insertError);
      return jsonResp({ error: "persist_failed", detail: msg }, 500);
    }

    return jsonResp(inserted, 200);
  } catch (e) {
    console.error("analyze-personality error:", e);
    return jsonResp(
      { error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});

