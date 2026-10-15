// Client-side view of the do-not-contact list (contact_suppressions,
// migration 20261015100000). The send paths decide on the server through
// suppressed_user_ids() / is_contact_suppressed(); this module only lets the
// admin UI show who is covered, with the same matching rules.

export interface ContactSuppression {
  id: string;
  user_id: string | null;
  phone: string | null;
  /** Generated column: last 9 digits of phone. */
  phone_key: string | null;
  email: string | null;
  /** Generated column: trimmed, lower-cased email. */
  email_key: string | null;
  reason: string | null;
  source: 'self' | 'admin' | 'api';
  created_by: string | null;
  created_at: string;
}

export interface Person { id: string; phone: string | null; email: string | null }

/** Same as SQL public.contact_phone_key: the last 9 digits; under 8 digits is no key. */
export function contactPhoneKey(raw: unknown): string | null {
  const digits = raw === null || raw === undefined ? '' : String(raw).replace(/\D/g, '');
  return digits.length < 8 ? null : digits.slice(-9);
}

/** Same as the SQL email_key column. */
export function contactEmailKey(raw: unknown): string | null {
  const key = raw === null || raw === undefined ? '' : String(raw).trim().toLowerCase();
  return key || null;
}

/** Every entry that names this person: by account, profile phone or profile email. */
export function entriesCovering(entries: ContactSuppression[], person: Person): ContactSuppression[] {
  const phoneKey = contactPhoneKey(person.phone);
  const emailKey = contactEmailKey(person.email);
  return entries.filter((e) =>
    e.user_id === person.id
    || (phoneKey !== null && e.phone_key === phoneKey)
    || (emailKey !== null && e.email_key === emailKey));
}

export function suppressedPeople(entries: ContactSuppression[], people: Person[]): Set<string> {
  return new Set(people.filter((p) => entriesCovering(entries, p).length > 0).map((p) => p.id));
}
