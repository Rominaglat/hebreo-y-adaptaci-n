# Design: 1:1 Private Lesson request button + lead-capture popup

**Date:** 2026-06-22
**Status:** Approved (pending spec review)
**Area:** `learning-portal` (Vite + React + TS SPA, shadcn/ui, RTL Hebrew, he/en/es)

## Goal

Add a button next to the search in the main top bar that opens a popup where a
user can leave their details (name, email, phone) to request **1:1 private
lessons**. The popup explains that, on top of the regular subscription, the user
can purchase a package of 1:1 reinforcement lessons — making clear this is an
**additional, separate charge**. On submit, the details are POSTed as a webhook
to a Make.com endpoint.

## Decisions (locked)

- **Placement:** main app header — `src/components/layout/DashboardLayout.tsx`,
  immediately before the ⌘K quick-search button (~line 307). Sits next to the
  search in the top bar.
- **Audience:** all logged-in users, including `lead` (prospect/sales) accounts.
  No role gating.
- **Submission:** direct browser `fetch` POST of `application/json` to the Make
  webhook. CORS verified — the endpoint returns `access-control-allow-origin: *`,
  allows `POST`, and allows the `content-type` header, so a JSON POST succeeds and
  the response status is readable for real success/error handling. No proxy needed.
- **Webhook URL:** `https://hook.us2.make.com/t0llq7nwgfh3slg1cgxpm4ut6jlwfpkm`,
  stored as a constant, overridable via `VITE_PRIVATE_LESSON_WEBHOOK_URL`.

## Architecture

Logic is split from UI for testability and clear boundaries.

### `src/lib/privateLesson.ts` (pure + I/O, unit-tested)
- `WEBHOOK_URL` — constant; reads `import.meta.env.VITE_PRIVATE_LESSON_WEBHOOK_URL`
  and falls back to the Make URL above.
- `LeadForm` type — `{ name: string; email: string; phone: string }`.
- `validateLeadForm(form): { ok: true } | { ok: false; field: 'name'|'email'|'contact'; }`
  - `name` required (non-empty after trim).
  - `email` must be valid format **if** provided.
  - at least one of `email` / `phone` must be provided (`contact`).
- `buildPrivateLessonPayload(form, ctx)` — returns the webhook payload object
  (pure; timestamp/locale/userId/page passed in as `ctx`, never read from globals,
  so it is deterministic and testable).
- `submitPrivateLessonRequest(form, ctx)` — builds the payload and performs the
  POST; resolves on `res.ok`, rejects otherwise. The only side-effecting function.

### `src/components/PrivateLessonDialog.tsx` (UI)
Self-contained: renders the trigger `Button` + a shadcn `Dialog` containing the
form. Consumes `useAuth()` (preload + `profile.id`), `useLanguage()` (`t`,
`language`), `useToast()` (feedback), and `useLocation()` (page context).
`DashboardLayout` adds a single `<PrivateLessonDialog />` next to the ⌘K button.

- **Trigger button:** icon = `GraduationCap` (lucide). Style mirrors the existing
  ⌘K hint button. Desktop shows icon + label `t('privateLesson.button')`; on
  small screens it collapses to icon-only with an `aria-label`.
- **Dialog body:**
  - Title: `t('privateLesson.title')`.
  - Description paragraph: `t('privateLesson.description')` — explains the 1:1
    reinforcement package is available **in addition to** the subscription.
  - An explicit emphasized note: `t('privateLesson.paidNote')` — states it is an
    additional payment beyond the subscription (visually distinct, e.g. muted/
    highlighted line).
  - Three fields (`Label` + `Input`): name, email (`type="email"`),
    phone (`type="tel"`), preloaded from `profile` and editable.
  - Inline validation message area: `t('privateLesson.validation.*')`.
  - Footer: Cancel (`common.cancel`) + Submit (`privateLesson.submit`) with a
    loading spinner + disabled state while posting.

### Data flow
1. Dialog open → fields initialize from `profile.full_name / email / phone`
   (re-synced on each open via effect keyed on open state).
2. Submit → `validateLeadForm`; on failure show the relevant inline message.
3. On valid → `submitPrivateLessonRequest(form, { userId: profile.id, locale:
   language, page: location.pathname, submittedAt: new Date().toISOString() })`.
4. Success → success toast (`privateLesson.toast.success`) + close dialog.
   Failure → error toast (`privateLesson.toast.error`); dialog stays open to retry.

### Webhook payload
```json
{
  "name": "...",
  "email": "...",
  "phone": "...",
  "request_type": "private_lesson_1on1",
  "source": "learning-portal",
  "user_id": "<profile.id | null>",
  "locale": "he|en|es",
  "page": "/dashboard",
  "submitted_at": "<ISO-8601>"
}
```

## Internationalization (he / en / es — all required)

New flat keys added to `src/contexts/LanguageContext.tsx`. Draft copy:

- `privateLesson.button`
  - he: `שיעור פרטי 1:1`
  - en: `1:1 Private Lesson`
  - es: `Clase privada 1:1`
- `privateLesson.title`
  - he: `בקשת שיעור פרטי 1:1`
  - en: `Request a 1:1 Private Lesson`
  - es: `Solicitar una clase privada 1:1`
- `privateLesson.description`
  - he: `בנוסף למנוי שלכם, ניתן לרכוש חבילת שיעורים פרטיים 1:1 לחיזוק אישי עם מדריך/ה. השאירו פרטים ונחזור אליכם עם הצעה מתאימה.`
  - en: `On top of your subscription, you can purchase a package of 1:1 private lessons for personal reinforcement with an instructor. Leave your details and we'll get back to you with an offer.`
  - es: `Además de tu suscripción, puedes adquirir un paquete de clases privadas 1:1 para reforzar tu aprendizaje con un instructor. Déjanos tus datos y te contactaremos con una propuesta.`
- `privateLesson.paidNote`
  - he: `שימו לב: מדובר בתשלום נוסף, בנפרד ומעבר לדמי המנוי.`
  - en: `Please note: this is an additional charge, separate from and on top of your subscription fee.`
  - es: `Ten en cuenta: tiene un costo adicional, aparte y por encima de tu suscripción.`
- `privateLesson.field.name` → `שם` / `Name` / `Nombre`
- `privateLesson.field.email` → `אימייל` / `Email` / `Correo electrónico`
- `privateLesson.field.phone` → `טלפון` / `Phone` / `Teléfono`
- `privateLesson.submit`
  - he: `שליחת פרטים` / en: `Send my details` / es: `Enviar mis datos`
- `privateLesson.validation.name` → name required (3 langs)
- `privateLesson.validation.email` → invalid email (3 langs)
- `privateLesson.validation.contact` → need email or phone (3 langs)
- `privateLesson.toast.success.title` / `.desc` → confirmation (3 langs)
- `privateLesson.toast.error.title` / `.desc` → failure + retry (3 langs)

Exact strings finalized during implementation; all three languages mandatory for
every key.

## Testing

`src/lib/privateLesson.test.ts` (Vitest):
- `validateLeadForm`: valid full form passes; empty name → `name`; bad email →
  `email`; name only (no contact) → `contact`; phone-only (no email) → ok.
- `buildPrivateLessonPayload`: produces the exact payload shape incl. constant
  `request_type`/`source` and the passed-in ctx fields.

Manual verification: open dialog → confirm preload from profile → edit a field →
submit → success toast → confirm the record arrives in the Make scenario; test an
induced failure path shows the error toast and keeps the dialog open.

## Files

- **New:** `src/lib/privateLesson.ts`
- **New:** `src/lib/privateLesson.test.ts`
- **New:** `src/components/PrivateLessonDialog.tsx`
- **Edit:** `src/components/layout/DashboardLayout.tsx` (insert `<PrivateLessonDialog />`)
- **Edit:** `src/contexts/LanguageContext.tsx` (add i18n keys)

## Out of scope / YAGNI

- No persistence in Supabase (webhook only).
- No admin UI / no payments flow (Make handles downstream).
- No rate-limiting/anti-abuse beyond basic validation (acceptable for a
  low-volume lead form behind login).
