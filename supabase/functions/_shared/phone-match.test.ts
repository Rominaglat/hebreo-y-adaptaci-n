import { describe, it, expect } from 'vitest';
import {
  toDigits,
  phoneKey,
  isMatchableInput,
  matchPhone,
  MATCH_DIGITS_MAX,
  MATCH_DIGITS_MIN,
  type PhoneCandidate,
} from './phone-match';

/** A candidate row, spelled the way profiles rows reach the matcher. */
const p = (id: string, phone: string | null, deletedAt: string | null = null): PhoneCandidate => ({
  id,
  phone,
  deletedAt,
});

/** Asserts a single-profile hit and which rung of the ladder found it. */
const expectMatch = (result: ReturnType<typeof matchPhone>, id: string, rung: number) => {
  expect(result.status).toBe('matched');
  expect(result.matches.map((m) => m.id)).toEqual([id]);
  expect(result.matchedOn).toBe(rung);
};

describe('toDigits', () => {
  it('keeps only digits, dropping the punctuation admins actually type', () => {
    expect(toDigits('+972 (50) 123-4567')).toBe('972501234567');
  });

  it('accepts an unquoted JSON number, since a caller may not quote the phone', () => {
    expect(toDigits(972501234567)).toBe('972501234567');
  });

  it('refuses a fractional number rather than reading "0.5" as the digits 05', () => {
    expect(toDigits(0.5)).toBe('');
  });

  it('refuses a negative number', () => {
    expect(toDigits(-5)).toBe('');
  });

  it('refuses a number big enough to render in exponent notation, so 1e+21 never becomes 121', () => {
    expect(toDigits(1e21)).toBe('');
  });

  it('yields nothing for null, undefined and non-primitives', () => {
    expect(toDigits(null)).toBe('');
    expect(toDigits(undefined)).toBe('');
    expect(toDigits({ phone: '0501234567' })).toBe('');
    expect(toDigits(true)).toBe('');
  });
});

describe('phoneKey', () => {
  it('returns the last n digits of a formatted number', () => {
    expect(phoneKey('050-1234567', 9)).toBe('501234567');
    expect(phoneKey('050-1234567', 8)).toBe('01234567');
  });

  it('returns null when the stored number is shorter than the key, instead of a padded compare', () => {
    expect(phoneKey('050-123', 8)).toBeNull();
  });

  it('returns null for null, empty and digitless storage', () => {
    expect(phoneKey(null, 9)).toBeNull();
    expect(phoneKey('', 9)).toBeNull();
    expect(phoneKey('n/a', 9)).toBeNull();
  });

  it('refuses a key length outside the ladder, which would be a mass-collision bug', () => {
    expect(() => phoneKey('0501234567', 7)).toThrow(/n must be 8\.\.9/);
    expect(() => phoneKey('0501234567', 10)).toThrow(/n must be 8\.\.9/);
    expect(() => phoneKey('0501234567', 8.5)).toThrow(/n must be 8\.\.9/);
  });

  it('pins the ladder bounds, because widening them silently widens the blast radius', () => {
    expect(MATCH_DIGITS_MAX).toBe(9);
    expect(MATCH_DIGITS_MIN).toBe(8);
  });
});

describe('isMatchableInput', () => {
  it('accepts anything carrying at least the floor number of digits', () => {
    expect(isMatchableInput('98212345')).toBe(true);
    expect(isMatchableInput('+972-50-123-4567')).toBe(true);
  });

  it('rejects input the matcher could only guess at', () => {
    expect(isMatchableInput('1234567')).toBe(false);
    expect(isMatchableInput('')).toBe(false);
    expect(isMatchableInput(null)).toBe(false);
  });
});

describe('Israeli numbers — 81 of the 104 stored rows', () => {
  const IL = [p('P1', '050-1234567')];

  it('IL-01 matches the same number once the dash is stripped', () => {
    expectMatch(matchPhone('0501234567', IL), 'P1', 9);
  });

  it('IL-02 matches an E.164 query against a stored national number', () => {
    expectMatch(matchPhone('+972501234567', IL), 'P1', 9);
  });

  it('IL-03 matches an international query written with dashes and no plus', () => {
    expectMatch(matchPhone('972-50-123-4567', IL), 'P1', 9);
  });

  it('IL-04 matches a query that dropped the trunk zero', () => {
    expectMatch(matchPhone('501234567', IL), 'P1', 9);
  });

  it('IL-05 matches a 00-prefixed international query, since 00 falls off the suffix', () => {
    expectMatch(matchPhone('00972501234567', IL), 'P1', 9);
  });

  it('IL-06 ignores leading, trailing and inner whitespace', () => {
    expectMatch(matchPhone('  050 123 4567  ', IL), 'P1', 9);
  });

  it('IL-07 ignores parentheses', () => {
    expectMatch(matchPhone('(050) 123-4567', IL), 'P1', 9);
  });

  it('IL-08 matches when the profile is the one stored without the trunk zero', () => {
    expectMatch(matchPhone('+972-50-123-4567', [p('P1', '501234567')]), 'P1', 9);
  });

  it('IL-09 matches the real 052/52 prod pair when only one of them exists', () => {
    expectMatch(matchPhone('0521234122', [p('P1', '521234122')]), 'P1', 9);
  });

  it('IL-10 falls to the 8-rung for a landline, whose 8-digit NSN cannot fill last-9', () => {
    expectMatch(matchPhone('098212345', [p('P1', '97298212345')]), 'P1', 8);
  });

  it('IL-11 matches the same landline pair in the other direction', () => {
    expectMatch(matchPhone('+97298212345', [p('P1', '09-821-2345')]), 'P1', 8);
  });

  it('IL-12 accepts a bare 8-digit landline NSN, exactly at the floor', () => {
    expectMatch(matchPhone('98212345', [p('P1', '97298212345')]), 'P1', 8);
  });

  it('IL-13 does not match when the last digit differs', () => {
    expect(matchPhone('0501234568', IL).status).toBe('not_found');
  });

  it('IL-14 does not match a different subscriber on the same carrier prefix', () => {
    expect(matchPhone('0509999999', IL).status).toBe('not_found');
  });

  it('IL-15 is not confused by a profile that shares only the carrier prefix', () => {
    const rows = [p('P1', '0509999999'), p('P2', '972501234567')];
    expectMatch(matchPhone('0501234567', rows), 'P2', 9);
  });
});

describe('Argentinian numbers', () => {
  const AR = [p('P1', '5491122334455')];

  it('AR-01 matches an identical E.164 number', () => {
    expectMatch(matchPhone('+5491122334455', AR), 'P1', 9);
  });

  it('AR-02 matches the 10-digit national form', () => {
    expectMatch(matchPhone('1122334455', AR), 'P1', 9);
  });

  it('AR-03 matches the national form with a trunk zero', () => {
    expectMatch(matchPhone('01122334455', AR), 'P1', 9);
  });

  it('AR-04 matches when the caller omitted the mobile 9', () => {
    expectMatch(matchPhone('+541122334455', AR), 'P1', 9);
  });

  it('AR-05 ignores the spaces and dash of a hand-written +54 9 11 number', () => {
    expectMatch(matchPhone('+54 9 11 2233-4455', AR), 'P1', 9);
  });

  it('AR-06 matches an E.164 query against the two rows stored in national form', () => {
    expectMatch(matchPhone('5491122334455', [p('P1', '1122334455')]), 'P1', 9);
  });

  it('AR-07 absorbs the legacy 15 on the 8-rung when the area code is 2 digits, because the 15 falls just outside the window', () => {
    expectMatch(matchPhone('011 15 2233-4455', AR), 'P1', 8);
  });

  it('AR-08 matches a Cordoba 351 number stored in national form', () => {
    expectMatch(matchPhone('+543511234556', [p('P1', '3511234556')]), 'P1', 9);
  });

  it('AR-09 still finds a 3-digit-area number written with the legacy 15, where the suffix compare alone cannot', () => {
    // The 15 lands INSIDE the window here, so neither rung's key agrees — only
    // the legacy-15 rewrite recovers the row. 4 of the 9 Argentine profiles in
    // production have a 3- or 4-digit area code.
    expect(phoneKey('0351 15 1234556', 9)).not.toBe(phoneKey('5493511234556', 9));
    expect(phoneKey('0351 15 1234556', 8)).not.toBe(phoneKey('5493511234556', 8));
    expectMatch(matchPhone('0351 15 1234556', [p('P1', '5493511234556')]), 'P1', 9);
  });

  it('AR-10 applies the legacy-15 rewrite to a 4-digit area code too', () => {
    expectMatch(matchPhone('02966 15 123456', [p('P1', '5492966123456')]), 'P1', 9);
  });

  it('AR-11 never runs the rewrite once the plain ladder has answered', () => {
    // The rewrite of '011 15 2233-4455' is '1122334455', which would have found
    // this same row on the 9-rung. Seeing rung 8 in the result is the proof that
    // the second pass did not run: the retry is additive, not an override.
    expectMatch(matchPhone('011 15 2233-4455', [p('P1', '5491122334455'), p('P2', '5493511234556')]), 'P1', 8);
  });

  it('AR-12 refuses to rewrite a number that only looks like the legacy form', () => {
    // No trunk 0, and area+subscriber would come to 11 digits, not 10 — so this
    // E.164-shaped string keeps its own tail instead of being rewritten.
    expect(matchPhone('5491522334455', [p('P1', '5492233445566')]).status).toBe('not_found');
  });

  it('AR-13 leaves an Israeli national number well clear of the legacy-15 rewrite', () => {
    // 10 digits can never satisfy 0 + area(2-4) + 15 + subscriber(6-8).
    expect(matchPhone('0501512345', [p('P1', '5491512345')]).status).toBe('not_found');
  });
});

describe('the rest of Latin America', () => {
  it('CL-01 matches an identical Chilean E.164 number', () => {
    expectMatch(matchPhone('+56987654321', [p('P1', '56987654321')]), 'P1', 9);
  });

  it('CL-02 matches the Chilean national number, which is exactly the 9-digit key', () => {
    expectMatch(matchPhone('987654321', [p('P1', '56987654321')]), 'P1', 9);
  });

  it('CL-03 ignores a 00 prefix on a Chilean number', () => {
    expectMatch(matchPhone('0056987654321', [p('P1', '56987654321')]), 'P1', 9);
  });

  it('CO-01 matches an identical Colombian E.164 number', () => {
    expectMatch(matchPhone('+573001234567', [p('P1', '573001234567')]), 'P1', 9);
  });

  it('CO-02 matches the Colombian 10-digit national form', () => {
    expectMatch(matchPhone('3001234567', [p('P1', '573001234567')]), 'P1', 9);
  });

  it('MX-01 matches an identical Mexican E.164 number', () => {
    expectMatch(matchPhone('+525512345678', [p('P1', '525512345678')]), 'P1', 9);
  });

  it('MX-02 matches the Mexican 10-digit national form', () => {
    expectMatch(matchPhone('5512345678', [p('P1', '525512345678')]), 'P1', 9);
  });

  it('MX-03 tolerates the legacy +52 1 mobile marker, which falls off the suffix', () => {
    expectMatch(matchPhone('+5215512345678', [p('P1', '525512345678')]), 'P1', 9);
  });

  it('CR-01 reaches a stored 8-digit Costa Rican number from an E.164 query', () => {
    expectMatch(matchPhone('+50685551234', [p('P1', '85551234')]), 'P1', 8);
  });

  it('CR-02 reaches a stored E.164 Costa Rican number from an 8-digit query', () => {
    expectMatch(matchPhone('85551234', [p('P1', '50685551234')]), 'P1', 8);
  });

  it('CR-03 resolves two identical Costa Rican E.164 numbers on the first rung', () => {
    expectMatch(matchPhone('+50685551234', [p('P1', '50685551234')]), 'P1', 9);
  });

  it('PY-01 matches the prod row that kept a trunk zero after the 595 country code', () => {
    expectMatch(matchPhone('+595981234546', [p('P1', '5950981234546')]), 'P1', 9);
  });

  it('PY-02 matches the same row from the Paraguayan national form', () => {
    expectMatch(matchPhone('0981234546', [p('P1', '5950981234546')]), 'P1', 9);
  });
});

describe('cross-country isolation', () => {
  it('XC-01 does not let an Israeli query reach a Costa Rican profile on either rung', () => {
    expect(matchPhone('0501234567', [p('P1', '50685551234')]).status).toBe('not_found');
  });

  it('XC-02 does not let a Costa Rican query reach an Israeli profile', () => {
    expect(matchPhone('+50685551234', [p('P1', '050-1234567')]).status).toBe('not_found');
  });
});

describe('bad input from the caller', () => {
  const IL = [p('P1', '050-1234567')];

  it('IN-01 rejects a 7-digit query as below the floor, not as a miss', () => {
    const r = matchPhone('1234567', IL);
    expect(r.status).toBe('invalid_input');
    expect(r.queryDigits).toBe(7);
    expect(r.matches).toEqual([]);
  });

  it('IN-02 rejects a 3-digit query', () => {
    expect(matchPhone('050', IL).status).toBe('invalid_input');
  });

  it('IN-03 rejects an empty string', () => {
    expect(matchPhone('', IL).status).toBe('invalid_input');
  });

  it('IN-04 rejects a whitespace-only string', () => {
    expect(matchPhone('   ', IL).status).toBe('invalid_input');
  });

  it('IN-05 rejects letters, which carry no digits', () => {
    expect(matchPhone('abcdefghij', IL).status).toBe('invalid_input');
  });

  it('IN-06 rejects punctuation only', () => {
    expect(matchPhone('+++---()', IL).status).toBe('invalid_input');
  });

  it('IN-07 still matches a tel: URI, since the letters strip away and 12 digits survive', () => {
    expectMatch(matchPhone('tel:+972-50-123-4567', IL), 'P1', 9);
  });

  it('IN-08 treats an over-long query as a miss, never an error — length alone is not invalid', () => {
    expect(matchPhone('9725012345670000', IL).status).toBe('not_found');
  });

  it('rejects null, undefined and an object body as invalid rather than throwing', () => {
    expect(matchPhone(null, IL).status).toBe('invalid_input');
    expect(matchPhone(undefined, IL).status).toBe('invalid_input');
    expect(matchPhone({ phone: '0501234567' }, IL).status).toBe('invalid_input');
  });

  it('accepts an unquoted JSON number as the query', () => {
    expectMatch(matchPhone(972501234567, IL), 'P1', 9);
  });
});

describe('junk in the stored column', () => {
  it('ST-01 never matches a stored empty string', () => {
    expect(matchPhone('0501234567', [p('P1', '')]).status).toBe('not_found');
  });

  it('ST-02 never matches stored whitespace', () => {
    expect(matchPhone('0501234567', [p('P1', '   ')]).status).toBe('not_found');
  });

  it('ST-03 never matches a stored NULL, which 44 prod rows have', () => {
    expect(matchPhone('0501234567', [p('P1', null)]).status).toBe('not_found');
  });

  it('ST-04 never matches stored text with no digits at all', () => {
    expect(matchPhone('0501234567', [p('P1', 'n/a')]).status).toBe('not_found');
  });

  it('ST-05 never matches a stored number shorter than the key', () => {
    expect(matchPhone('0501234567', [p('P1', '050-123')]).status).toBe('not_found');
  });

  it('survives a candidate list that is entirely unusable', () => {
    const junk = [p('P1', null), p('P2', ''), p('P3', 'llamar al fijo')];
    expect(matchPhone('0501234567', junk).status).toBe('not_found');
  });

  it('returns not_found rather than throwing on an empty candidate list', () => {
    expect(matchPhone('0501234567', []).status).toBe('not_found');
  });
});

describe('ambiguity is terminal, never a tie-break', () => {
  it('AM-01 returns both profiles when two different people share one handset', () => {
    const rows = [p('P1', '050-1234777'), p('P2', '0501234777')];
    const r = matchPhone('+972501234777', rows);
    expect(r.status).toBe('ambiguous');
    expect(r.matches.map((m) => m.id)).toEqual(['P1', 'P2']);
    expect(r.matchedOn).toBe(9);
  });

  it('AM-02 returns both accounts of the real 052/52 duplicate-account pair', () => {
    const rows = [p('P1', '0521234122'), p('P2', '521234122')];
    const r = matchPhone('0521234122', rows);
    expect(r.status).toBe('ambiguous');
    expect(r.matches.map((m) => m.id)).toEqual(['P1', 'P2']);
  });

  it('AM-03 returns only the genuine collisions, not the prefix-sharing bystander', () => {
    const rows = [p('P1', '050-1234777'), p('P2', '0501234777'), p('P3', '0509999999')];
    const r = matchPhone('0501234777', rows);
    expect(r.status).toBe('ambiguous');
    expect(r.matches.map((m) => m.id)).toEqual(['P1', 'P2']);
  });

  it('does not let an 8-rung neighbour dilute a number that already resolved at 9', () => {
    // Both rows end in the same 8 digits (01234567) but only P1 ends in the
    // same 9. Stopping on the first rung that hits is what keeps this a match.
    const rows = [p('P1', '050-1234567'), p('P2', '0301234567')];
    expectMatch(matchPhone('0501234567', rows), 'P1', 9);
  });
});

describe('soft-deleted profiles', () => {
  const DELETED = '2026-07-01T00:00:00.000Z';

  it('DL-01 reports matched_deleted when the only match is soft-deleted', () => {
    const r = matchPhone('0501234567', [p('P1', '050-1234567', DELETED)]);
    expect(r.status).toBe('matched_deleted');
    expect(r.matches.map((m) => m.id)).toEqual(['P1']);
    expect(r.matchedOn).toBe(9);
  });

  it('DL-02 lets a live profile win over a soft-deleted duplicate instead of reading as ambiguous', () => {
    const rows = [p('P1', '050-1234567', DELETED), p('P2', '972501234567')];
    expectMatch(matchPhone('0501234567', rows), 'P2', 9);
  });

  it('DL-03 returns every soft-deleted match when they are all deleted', () => {
    const rows = [p('P1', '050-1234567', DELETED), p('P2', '0501234567', DELETED)];
    const r = matchPhone('0501234567', rows);
    expect(r.status).toBe('matched_deleted');
    expect(r.matches.map((m) => m.id)).toEqual(['P1', 'P2']);
  });

  it('treats a row with no deletedAt property at all as live', () => {
    const r = matchPhone('0501234567', [{ id: 'P1', phone: '050-1234567' }]);
    expect(r.status).toBe('matched');
  });
});

describe('result metadata the edge function logs', () => {
  it('reports the digit count of the query so the 400 can say how short it was', () => {
    expect(matchPhone('050-123', []).queryDigits).toBe(6);
    expect(matchPhone('+972-50-123-4567', []).queryDigits).toBe(12);
  });

  it('leaves matchedOn null when nothing fired, so an 8-rung spike stays visible in the logs', () => {
    expect(matchPhone('0501234567', []).matchedOn).toBeNull();
    expect(matchPhone('123', []).matchedOn).toBeNull();
  });

  it('does not mutate or reorder the candidate list it was given', () => {
    const rows = [p('P1', '0509999999'), p('P2', '050-1234567')];
    const snapshot = JSON.parse(JSON.stringify(rows));
    matchPhone('0501234567', rows);
    expect(rows).toEqual(snapshot);
  });

  it('carries extra columns through, so the handler can read full_name off the match', () => {
    const rows = [{ id: 'P1', phone: '050-1234567', deletedAt: null, email: 'a@b.co' }];
    const r = matchPhone('0501234567', rows);
    expect(r.matches[0].email).toBe('a@b.co');
  });
});
