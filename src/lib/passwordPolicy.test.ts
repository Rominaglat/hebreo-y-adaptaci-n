import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkPasswordPolicy,
  checkPwnedPassword,
  validatePassword,
} from './passwordPolicy';

describe('checkPasswordPolicy', () => {
  it('rejects passwords shorter than 12 chars', () => {
    const r = checkPasswordPolicy('Aa1!Aa1!Aa1');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('too_short');
  });

  it('rejects passwords without a letter', () => {
    const r = checkPasswordPolicy('123456789012!@#');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('no_letter');
  });

  it('rejects passwords without a digit', () => {
    const r = checkPasswordPolicy('AbcdefghIJKL!@#');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('no_digit');
  });

  it('rejects passwords without a symbol', () => {
    const r = checkPasswordPolicy('AbcdefghIJKL123');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('no_symbol');
  });

  it('accepts a policy-compliant password', () => {
    const r = checkPasswordPolicy('correct-horse-battery-staple-9!');
    expect(r.ok).toBe(true);
  });

  it('rejects non-string inputs', () => {
    // @ts-expect-error testing runtime type safety
    expect(checkPasswordPolicy(null).ok).toBe(false);
    // @ts-expect-error testing runtime type safety
    expect(checkPasswordPolicy(undefined).ok).toBe(false);
  });
});

describe('checkPwnedPassword (HIBP k-anonymity)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    // jsdom older versions lack crypto.subtle; fall back to node:crypto webcrypto.
    const cryptoAny = globalThis.crypto as unknown as { subtle?: SubtleCrypto };
    if (!cryptoAny || !cryptoAny.subtle) {
      const nodeCrypto = require('node:crypto');
      Object.defineProperty(globalThis, 'crypto', {
        value: nodeCrypto.webcrypto,
        configurable: true,
      });
    }
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('flags a password that appears in the HIBP range', async () => {
    // SHA1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    // Prefix: 5BAA6, suffix: 1E4C9B93F3F0682250B6CF8331B7EE68FD8
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        '0018A45C4D1DEF81644B54AB7F969B88D65:1\n' +
        '1E4C9B93F3F0682250B6CF8331B7EE68FD8:3730471\n',
    }) as unknown as typeof fetch;

    const r = await checkPwnedPassword('password');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('pwned');
  });

  it('passes a password not in the HIBP range', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '0000000000000000000000000000000000:1\n',
    }) as unknown as typeof fetch;

    const r = await checkPwnedPassword('correct-horse-battery-staple-99!');
    expect(r.ok).toBe(true);
    expect(r.code).toBeUndefined();
  });

  it('fails-open if HIBP is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network'));
    const r = await checkPwnedPassword('anything');
    expect(r.ok).toBe(true);
    expect(r.code).toBe('hibp_unreachable');
  });
});

describe('validatePassword (full chain)', () => {
  it('short-circuits on policy failure without hitting HIBP', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => '',
    } as unknown as Response);
    const r = await validatePassword('short');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('too_short');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
