// SEC-014 — password policy + HIBP breach check.
//
// Min 12 chars, must include a letter, a digit, and a symbol.
// On password set/reset, run a k-anonymity check against
// api.pwnedpasswords.com so we never send the full password and we reject
// known-breached passwords.

export interface PasswordCheck {
  ok: boolean;
  error?: string;
  // Bilingual error code so callers can translate.
  code?:
    | "too_short"
    | "no_letter"
    | "no_digit"
    | "no_symbol"
    | "pwned"
    | "hibp_unreachable";
}

const SYMBOL_RE = /[^A-Za-z0-9]/;
const LETTER_RE = /[A-Za-z]/;
const DIGIT_RE = /[0-9]/;

export function checkPasswordPolicy(password: string): PasswordCheck {
  if (typeof password !== "string" || password.length < 12) {
    return { ok: false, code: "too_short", error: "Password must be at least 12 characters" };
  }
  if (!LETTER_RE.test(password)) {
    return { ok: false, code: "no_letter", error: "Password must include a letter" };
  }
  if (!DIGIT_RE.test(password)) {
    return { ok: false, code: "no_digit", error: "Password must include a digit" };
  }
  if (!SYMBOL_RE.test(password)) {
    return { ok: false, code: "no_symbol", error: "Password must include a symbol" };
  }
  return { ok: true };
}

async function sha1Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-1", enc);
  const bytes = new Uint8Array(buf);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/**
 * Have-I-Been-Pwned k-anonymity check.
 * Sends only the first 5 hex chars of SHA1(password); compares the rest
 * client-side against the returned list. The full password never leaves the
 * browser.
 */
export async function checkPwnedPassword(password: string): Promise<PasswordCheck> {
  try {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const resp = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      // Use the Add-Padding header to obscure the response size, per HIBP recommendation.
      headers: { "Add-Padding": "true" },
    });
    if (!resp.ok) {
      // Don't fail closed — HIBP unreachable means we accept the password but warn.
      console.warn("[pwd] HIBP unreachable", resp.status);
      return { ok: true, code: "hibp_unreachable" };
    }
    const text = await resp.text();
    const lines = text.split("\n");
    for (const line of lines) {
      const [hashSuffix] = line.trim().split(":");
      if (hashSuffix && hashSuffix.toUpperCase() === suffix) {
        return { ok: false, code: "pwned", error: "This password has appeared in a data breach" };
      }
    }
    return { ok: true };
  } catch (e) {
    console.warn("[pwd] HIBP check threw:", e);
    return { ok: true, code: "hibp_unreachable" };
  }
}

/** Full check: policy first (cheap, sync-ish), then HIBP (network). */
export async function validatePassword(password: string): Promise<PasswordCheck> {
  const policy = checkPasswordPolicy(password);
  if (!policy.ok) return policy;
  return await checkPwnedPassword(password);
}
