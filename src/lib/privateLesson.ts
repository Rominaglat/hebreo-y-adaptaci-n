// Lead-capture logic for the "1:1 private lesson" request popup.
//
// Kept free of React/UI so the validation + payload shaping can be unit-tested
// in isolation. The component (PrivateLessonDialog) owns all rendering/state and
// delegates the actual submission here.

/** Webhook endpoint that receives a lead. Overridable per environment. */
export const PRIVATE_LESSON_WEBHOOK_URL =
  (import.meta.env.VITE_PRIVATE_LESSON_WEBHOOK_URL as string | undefined) ??
  'https://hook.us2.make.com/t0llq7nwgfh3slg1cgxpm4ut6jlwfpkm';

export interface LeadForm {
  name: string;
  email: string;
  phone: string;
}

/**
 * Result of validating the lead form. `field` is set only when `ok` is false and
 * names the offending field (maps to an inline i18n message in the UI). Kept as a
 * flat interface rather than a discriminated union so it narrows correctly under
 * this project's non-strict `tsconfig` (strictNullChecks is off).
 */
export interface LeadValidation {
  ok: boolean;
  field?: 'name' | 'email' | 'contact';
}

export interface PrivateLessonContext {
  /** Signed-in user's id, or null when unknown. */
  userId?: string | null;
  /** Active UI locale (he / en / es). */
  locale: string;
  /** Path the request was sent from, for context in the Make scenario. */
  page: string;
  /** ISO-8601 timestamp; injected so payload building stays deterministic. */
  submittedAt: string;
}

export interface PrivateLessonPayload {
  name: string;
  email: string;
  phone: string;
  request_type: 'private_lesson_1on1';
  source: 'learning-portal';
  user_id: string | null;
  locale: string;
  page: string;
  submitted_at: string;
}

// Pragmatic email shape check: a single @, non-empty local + domain, a dot in
// the domain, and no whitespace. Intentionally permissive — the goal is to catch
// obvious typos, not to RFC-validate.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Rules: name is required; email must look valid *if* supplied; and at least one
 * way to reach the person (email or phone) must be present.
 */
export function validateLeadForm(form: LeadForm): LeadValidation {
  const name = form.name.trim();
  const email = form.email.trim();
  const phone = form.phone.trim();

  if (!name) return { ok: false, field: 'name' };
  if (email && !EMAIL_RE.test(email)) return { ok: false, field: 'email' };
  if (!email && !phone) return { ok: false, field: 'contact' };
  return { ok: true };
}

/** Shapes the form + context into the JSON body sent to the webhook. */
export function buildPrivateLessonPayload(
  form: LeadForm,
  ctx: PrivateLessonContext,
): PrivateLessonPayload {
  return {
    name: form.name.trim(),
    email: form.email.trim(),
    phone: form.phone.trim(),
    request_type: 'private_lesson_1on1',
    source: 'learning-portal',
    user_id: ctx.userId ?? null,
    locale: ctx.locale,
    page: ctx.page,
    submitted_at: ctx.submittedAt,
  };
}

/**
 * POSTs the lead to the Make webhook. Resolves on a 2xx response; rejects
 * otherwise so the caller can surface an error and let the user retry.
 */
export async function submitPrivateLessonRequest(
  form: LeadForm,
  ctx: PrivateLessonContext,
): Promise<void> {
  const res = await fetch(PRIVATE_LESSON_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildPrivateLessonPayload(form, ctx)),
  });

  if (!res.ok) {
    throw new Error(`Private lesson webhook failed with status ${res.status}`);
  }
}
