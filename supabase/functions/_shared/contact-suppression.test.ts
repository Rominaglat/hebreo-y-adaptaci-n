import { describe, it, expect } from 'vitest';
import {
  contactPhoneKey,
  contactEmailKey,
  loadSuppressedUserIds,
  loadCancelledUserIds,
  withoutSuppressed,
} from './contact-suppression.ts';

const fakeClient = (rows: Array<{ user_id: string }> | null, error: { message: string } | null = null) => ({
  rpc: async (_fn: string) => ({ data: rows, error }),
});

describe('contactPhoneKey (mirrors SQL contact_phone_key)', () => {
  it('keeps the last 9 digits whatever the formatting', () => {
    expect(contactPhoneKey('053-344-4352')).toBe('533444352');
    expect(contactPhoneKey('+972 53 344 4352')).toBe('533444352');
    expect(contactPhoneKey(972533444352)).toBe('533444352');
  });
  it('keeps an 8-digit number whole', () => {
    expect(contactPhoneKey('22334455')).toBe('22334455');
  });
  it('is null for anything shorter, or empty', () => {
    expect(contactPhoneKey('1234567')).toBeNull();
    expect(contactPhoneKey('')).toBeNull();
    expect(contactPhoneKey(null)).toBeNull();
  });
});

describe('contactEmailKey (mirrors the SQL email_key column)', () => {
  it('trims and lower-cases', () => {
    expect(contactEmailKey('  Vania.X@Hotmail.com ')).toBe('vania.x@hotmail.com');
  });
  it('is null for blanks', () => {
    expect(contactEmailKey('   ')).toBeNull();
    expect(contactEmailKey(undefined)).toBeNull();
  });
});

describe('loaders', () => {
  it('turn the RPC rows into a set of user ids', async () => {
    const ids = await loadSuppressedUserIds(fakeClient([{ user_id: 'a' }, { user_id: 'b' }]));
    expect([...ids].sort()).toEqual(['a', 'b']);
    const cancelled = await loadCancelledUserIds(fakeClient([{ user_id: 'c' }]));
    expect([...cancelled]).toEqual(['c']);
  });

  it('fail closed: an unreadable list throws instead of reading as empty', async () => {
    await expect(loadSuppressedUserIds(fakeClient(null, { message: 'boom' }))).rejects.toThrow(/do-not-contact list/);
  });
});

describe('withoutSuppressed', () => {
  it('drops listed recipients and reports how many', () => {
    const { kept, dropped } = withoutSuppressed(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      (r) => r.id,
      new Set(['b']),
    );
    expect(kept.map((r) => r.id)).toEqual(['a', 'c']);
    expect(dropped).toBe(1);
  });
});
