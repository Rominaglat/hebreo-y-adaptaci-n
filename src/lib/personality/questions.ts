// Personality assessment question bank — v3.
// All 30 items are Likert 1–5 ("בכלל לא נכון אצלי" → "נכון מאוד אצלי").
//
// Structure:
//  - 18 E-Myth items: 6 per axis (EM/MN/AR), 2 reverse-keyed per axis (the …_04/05/06 trio)
//  - 12 DISC items: 3 per color (R/Y/G/B), 1 reverse-keyed per color
//
// v3 (vs v2) — broadened reverse-keyed coverage so honest response patterns
// don't all flatten into "balanced" through acquiescence. 7 items rewritten
// in opposite direction; total stays at 30.
//
// Order is interleaved across all 7 dimensions so users never see two
// consecutive items measuring the same axis. Hebrew, gender-neutral.
//
// Bump QUESTIONS_VERSION when changing wording/structure so old in-progress
// sessions reset and the edge function can interpret answers per version.

import type { Question } from './types';

export const QUESTIONS_VERSION = 3;

// Reverse-keyed Likert qids — must match REVERSE_BY_VERSION[3] in the edge function.
export const REVERSE_QIDS = [
  // E-Myth: 2 reverse per axis
  'EM_04', 'EM_06',
  'MN_05', 'MN_06',
  'AR_05', 'AR_06',
  // DISC: 1 reverse per color
  'DISC_R_01',
  'DISC_Y_03',
  'DISC_G_03',
  'DISC_B_02',
] as const;

// ─── E-Myth items (18) ────────────────────────────────────────────────

const EMYTH_ITEMS: Question[] = [
  // יזם (Entrepreneur) — חזון, חשיבה אסטרטגית, יצירת הזדמנויות
  { qid: 'EM_01', type: 'likert', axis: 'EM',
    text: 'כשנפתחת הזדמנות חדשה, הפוטנציאל הגדול שלה מורגש מיד.' },
  { qid: 'EM_02', type: 'likert', axis: 'EM',
    text: 'מחשבה על איך העסק יכול להיראות בעוד חמש שנים מעוררת התרגשות, לא חרדה.' },
  { qid: 'EM_03', type: 'likert', axis: 'EM',
    text: 'הרעיון הראשון שעולה בראש הוא בדרך כלל ליצור משהו חדש, לא לתקן את הקיים.' },
  { qid: 'EM_04', type: 'likert', axis: 'EM', reverse: true,
    text: 'קשה להציג רעיון גדול לקבוצה לפני שיש לו תוכנית מסודרת ומפורטת.' },
  { qid: 'EM_05', type: 'likert', axis: 'EM',
    text: 'שעמום מהרוטינה הוא הסיבה השכיחה לחפש שינוי.' },
  { qid: 'EM_06', type: 'likert', axis: 'EM', reverse: true,
    text: 'יותר נוח להישאר עם מה שכבר עובד מאשר לחפש משהו חדש שעדיין לא קיים.' },

  // מנהל (Manager) — סדר, מערכות, תכנון, יציבות
  { qid: 'MN_01', type: 'likert', axis: 'MN',
    text: 'תוכנית מסודרת לפני התחלה של משימה משפרת מאוד את הביצועים.' },
  { qid: 'MN_02', type: 'likert', axis: 'MN',
    text: 'בסיום מטלה יש סיפוק מיוחד מלסמן אותה ברשימה.' },
  { qid: 'MN_03', type: 'likert', axis: 'MN',
    text: 'עבודה של אחרים בלי שיטה מרגישה כמו רעש מטריד.' },
  { qid: 'MN_04', type: 'likert', axis: 'MN',
    text: 'תהליכים, רשימות משימות ולוחות זמנים מרגישים ככלי עזר ולא ככלי מעיק.' },
  { qid: 'MN_05', type: 'likert', axis: 'MN', reverse: true,
    text: 'התחלה של משהו חדש מרגישה הרבה יותר טבעית מהשלמת מה שכבר התחיל.' },
  { qid: 'MN_06', type: 'likert', axis: 'MN', reverse: true,
    text: 'לוחות זמנים נוקשים מרגישים יותר כמו חנק מאשר ביטחון.' },

  // אומן (Artisan) — מקצועיות, ביצוע, פירוט, איכות
  { qid: 'AR_01', type: 'likert', axis: 'AR',
    text: 'יש הנאה אמיתית מהשקעת שעות בשיפור משהו עד שיוצא בדיוק כמו שצריך.' },
  { qid: 'AR_02', type: 'likert', axis: 'AR',
    text: 'עדיפה משימה אחת שמבוצעת לעומק על פני חמש משימות חצי-גמורות.' },
  { qid: 'AR_03', type: 'likert', axis: 'AR',
    text: 'בבחירה בין לעשות לבד או להסביר לאחרים — לעשות לבד מרגיש יותר טבעי.' },
  { qid: 'AR_04', type: 'likert', axis: 'AR',
    text: 'שאיפה לדיוק מלווה כל פרויקט, וקשה לעצור ב"מספיק טוב".' },
  { qid: 'AR_05', type: 'likert', axis: 'AR', reverse: true,
    text: 'בנייה של תהליכים שאחרים יבצעו מעניינת יותר מעבודה ידנית בכלי העבודה עצמם.' },
  { qid: 'AR_06', type: 'likert', axis: 'AR', reverse: true,
    text: 'לעיתים קרובות עדיף להעביר משימה הלאה למישהו אחר מאשר לבצע אותה ביד.' },
];

// ─── DISC items (12) — 3 per color, all Likert ────────────────────────

const DISC_ITEMS: Question[] = [
  // R (אדום, משימתי) — ישיר, ממוקד תוצאות
  { qid: 'DISC_R_01', type: 'likert', axis: 'R', reverse: true,
    text: 'בקבלת החלטות גדולות נכון יותר להמתין ולשקול שוב מאשר למהר ולסגור.' },
  { qid: 'DISC_R_02', type: 'likert', axis: 'R',
    text: 'תוצאות מדידות חשובות הרבה יותר מתהליך נעים.' },
  { qid: 'DISC_R_03', type: 'likert', axis: 'R',
    text: 'התעמתות ישירה עם בעיות מרגישה יותר טבעית מהליכה סביבן.' },

  // Y (צהוב, מקדם) — חברותי, אופטימי, יצירתי
  { qid: 'DISC_Y_01', type: 'likert', axis: 'Y',
    text: 'יצירת קשר עם אנשים חדשים נעשית בקלות ובמהירות.' },
  { qid: 'DISC_Y_02', type: 'likert', axis: 'Y',
    text: 'בלחץ, שיחה עם אנשים אחרים עוזרת לפרוק יותר משעבודה לבד.' },
  { qid: 'DISC_Y_03', type: 'likert', axis: 'Y', reverse: true,
    text: 'מתאים לי הרבה יותר לנהל שיחה רגועה ועניינית מאשר להיות באווירה רועשת, מלאת התלהבות וסיפורים.' },

  // G (ירוק, מכיל) — סבלני, נאמן, מייצב
  { qid: 'DISC_G_01', type: 'likert', axis: 'G',
    text: 'סבלנות והקשבה לאחרים בולטות אצלי הרבה יותר מקצב מהיר וביטוי עצמי חזק.' },
  { qid: 'DISC_G_02', type: 'likert', axis: 'G',
    text: 'שמירה על מה שעובד עדיפה על קפיצה מהירה לרעיון חדש.' },
  { qid: 'DISC_G_03', type: 'likert', axis: 'G', reverse: true,
    text: 'תפקיד שמטלטל את הצוות ודוחף לשינויים מתאים יותר מתפקיד הגורם המייצב והמרגיע.' },

  // B (כחול, מנתח) — מדויק, יסודי, מבוסס נתונים
  { qid: 'DISC_B_01', type: 'likert', axis: 'B',
    text: 'בדיקה יסודית של פרטים לפני קבלת החלטה היא הרגל קבוע.' },
  { qid: 'DISC_B_02', type: 'likert', axis: 'B', reverse: true,
    text: 'סיום מהיר של משימה חשוב הרבה יותר מדיוק מלא של כל פרט.' },
  { qid: 'DISC_B_03', type: 'likert', axis: 'B',
    text: 'החלטות מתבססות לרוב על נתונים והגיון, לא על תחושת בטן.' },
];

// ─── Interleaved order ────────────────────────────────────────────────
// Pattern of 5 per cycle: [EM, color, MN, color, AR]. 6 cycles = 30 items.
// 6 EM + 6 MN + 6 AR + 12 DISC (3 per color, distributed evenly).

const INTERLEAVED_ORDER = [
  // cycle 1
  'EM_01', 'DISC_R_01', 'MN_01', 'DISC_Y_01', 'AR_01',
  // cycle 2
  'EM_02', 'DISC_G_01', 'MN_02', 'DISC_B_01', 'AR_02',
  // cycle 3
  'EM_03', 'DISC_R_02', 'MN_03', 'DISC_Y_02', 'AR_03',
  // cycle 4
  'EM_04', 'DISC_G_02', 'MN_04', 'DISC_B_02', 'AR_04',
  // cycle 5
  'EM_05', 'DISC_R_03', 'MN_05', 'DISC_Y_03', 'AR_05',
  // cycle 6
  'EM_06', 'DISC_G_03', 'MN_06', 'DISC_B_03', 'AR_06',
];

const ALL_BY_QID = new Map<string, Question>();
for (const q of [...EMYTH_ITEMS, ...DISC_ITEMS]) {
  ALL_BY_QID.set(q.qid, q);
}

export const QUESTIONS: Question[] = INTERLEAVED_ORDER.map((qid) => {
  const q = ALL_BY_QID.get(qid);
  if (!q) throw new Error(`questions.ts: missing qid in INTERLEAVED_ORDER: ${qid}`);
  return q;
});

export const EXPECTED_TOTAL = 30;

if (QUESTIONS.length !== EXPECTED_TOTAL) {
  throw new Error(
    `personality questions.ts: expected ${EXPECTED_TOTAL} items, got ${QUESTIONS.length}`,
  );
}
