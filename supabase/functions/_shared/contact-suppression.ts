// The do-not-contact list, as every sender reads it (migration
// 20261015100000_contact_suppressions). Someone on the list gets nothing from
// us: no email, no push, no WhatsApp.
//
// The loaders FAIL CLOSED: if the list cannot be read, they throw, and the
// sender must abort its run rather than treat the list as empty — sending one
// message to someone who asked to be removed is worse than a delayed sweep.

/** Minimal RPC surface, so this module needs no supabase-js import (and runs under vitest). */
interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** Same as SQL public.contact_phone_key: the last 9 digits; under 8 digits is no key. */
export function contactPhoneKey(raw: unknown): string | null {
  const digits = raw === null || raw === undefined ? '' : String(raw).replace(/\D/g, '');
  return digits.length < 8 ? null : digits.slice(-9);
}

/** Same as the SQL email_key column: trimmed, lower-cased, null when blank. */
export function contactEmailKey(raw: unknown): string | null {
  const key = raw === null || raw === undefined ? '' : String(raw).trim().toLowerCase();
  return key || null;
}

async function loadIds(client: RpcClient, fn: string, what: string): Promise<Set<string>> {
  const { data, error } = await client.rpc(fn);
  if (error) throw new Error(`Could not read the ${what}: ${error.message}`);
  return new Set(((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));
}

/** Portal accounts on the do-not-contact list (by account, profile phone or profile email). */
export const loadSuppressedUserIds = (client: RpcClient) =>
  loadIds(client, 'suppressed_user_ids', 'do-not-contact list');

/** Students whose every subscription row in the synced customer sheet is cancelled. */
export const loadCancelledUserIds = (client: RpcClient) =>
  loadIds(client, 'subscription_cancelled_user_ids', 'cancelled-subscription list');

export function withoutSuppressed<T>(
  recipients: T[],
  idOf: (r: T) => string,
  suppressed: Set<string>,
): { kept: T[]; dropped: number } {
  const kept = recipients.filter((r) => !suppressed.has(idOf(r)));
  return { kept, dropped: recipients.length - kept.length };
}
