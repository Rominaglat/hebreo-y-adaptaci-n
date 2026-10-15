import { describe, it, expect } from 'vitest';
import {
  contactPhoneKey,
  contactEmailKey,
  entriesCovering,
  suppressedPeople,
  type ContactSuppression,
} from './contactSuppression';

let seq = 0;
const entry = (over: Partial<ContactSuppression>): ContactSuppression => ({
  id: `e${++seq}`,
  user_id: null,
  phone: null,
  phone_key: null,
  email: null,
  email_key: null,
  reason: null,
  source: 'admin',
  created_by: null,
  created_at: '2026-10-15T10:00:00Z',
  ...over,
});

const vania = { id: 'u-vania', phone: '053-344-4352', email: 'Vania@Example.com' };
const other = { id: 'u-other', phone: '050-000-0000', email: 'other@example.com' };

describe('keys (mirror the SQL)', () => {
  it('phone: last 9 digits, null under 8', () => {
    expect(contactPhoneKey('+972 53-344-4352')).toBe('533444352');
    expect(contactPhoneKey('1234567')).toBeNull();
  });
  it('email: trimmed and lower-cased', () => {
    expect(contactEmailKey(' Vania@Example.com ')).toBe('vania@example.com');
  });
});

describe('entriesCovering', () => {
  it('finds entries by account, by phone written any way, and by email in any case', () => {
    const byUser = entry({ user_id: 'u-vania' });
    const byPhone = entry({ phone: '+972533444352', phone_key: '533444352' });
    const byEmail = entry({ email: 'vania@example.com', email_key: 'vania@example.com' });
    const unrelated = entry({ phone: '0501112222', phone_key: '501112222' });
    expect(entriesCovering([byUser, byPhone, byEmail, unrelated], vania).map((e) => e.id))
      .toEqual([byUser.id, byPhone.id, byEmail.id]);
  });

  it('a person without phone or email is matched only by account', () => {
    const byPhone = entry({ phone: '0533444352', phone_key: '533444352' });
    expect(entriesCovering([byPhone], { id: 'x', phone: null, email: null })).toEqual([]);
  });
});

describe('suppressedPeople', () => {
  it('returns the ids of everyone some entry covers', () => {
    const ids = suppressedPeople([entry({ phone: '053 344 4352', phone_key: '533444352' })], [vania, other]);
    expect([...ids]).toEqual(['u-vania']);
  });
});
