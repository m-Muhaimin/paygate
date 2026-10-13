/**
 * Canonical payment-reference module (SPEC §2).
 *
 * A reference is exactly 8 characters: 7 random data characters followed by 1
 * checksum character. The charset deliberately excludes look-alikes (0 O 1 I L)
 * so references survive being read aloud, retyped or OCR'd from an SMS.
 *
 * This is the single source of truth for reference generation, normalisation,
 * validation and admin near-match suggestions. Everyone imports from here.
 */

/** 31 chars: digits 2-9 (8) + A-Z minus O,I,L (23). No look-alikes. */
export const REFERENCE_CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Total reference length (7 data + 1 check). */
export const REFERENCE_LENGTH = 8;

/** Characters reserved for look-alike disambiguation. */
export const LOOKALIKE_CHARS = "0O1IL";

const CHARSET_LENGTH = REFERENCE_CHARSET.length; // 31
const DATA_LENGTH = REFERENCE_LENGTH - 1; // 7

/**
 * Uniform random index in [0, CHARSET_LENGTH) using rejection sampling, so no
 * modulo bias is introduced even though 256 is not a multiple of 31.
 */
function randomCharsetIndex(): number {
  const limit = Math.floor(256 / CHARSET_LENGTH) * CHARSET_LENGTH; // 248
  const buf = new Uint8Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % CHARSET_LENGTH;
}

/** Checksum char for a 7-char data string: `charset[Σ(idx(c_i)+1)*(i+1) % 31]`. */
function checkCharFor(data: string): string {
  let checksum = 0;
  for (let i = 0; i < data.length; i++) {
    checksum += (REFERENCE_CHARSET.indexOf(data[i]) + 1) * (i + 1);
  }
  return REFERENCE_CHARSET[checksum % CHARSET_LENGTH];
}

/** Generate a new 8-character reference with a valid check char. */
export function generateReference(): string {
  let data = "";
  for (let i = 0; i < DATA_LENGTH; i++) {
    data += REFERENCE_CHARSET[randomCharsetIndex()];
  }
  return data + checkCharFor(data);
}

/**
 * Normalise raw reference input: uppercase, strip anything outside the charset
 * (spaces, hyphens, punctuation, look-alikes) and drop a leading `REF` token.
 *
 * The `REF` prefix is only dropped when it leaves more than a full-length token,
 * which preserves references that legitimately begin with the letters R-E-F.
 */
export function normalizeReference(input: string): string {
  if (typeof input !== "string" || input.length === 0) return "";
  const upper = input.toUpperCase();
  let out = "";
  for (const ch of upper) {
    if (REFERENCE_CHARSET.includes(ch)) out += ch;
  }
  if (out.startsWith("REF") && out.length > REFERENCE_LENGTH) {
    out = out.slice(3);
  }
  return out;
}

/** True when the normalised value is 8 charset chars with a matching check char. */
export function isValidReference(input: string): boolean {
  const ref = normalizeReference(input);
  if (ref.length !== REFERENCE_LENGTH) return false;
  const data = ref.slice(0, DATA_LENGTH);
  const check = ref[DATA_LENGTH];
  return checkCharFor(data) === check;
}

/** True when `a` and `b` differ by exactly one substitution or one insertion/deletion. */
function isEditDistanceOne(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;

  if (a.length === b.length) {
    let diffs = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i] && ++diffs > 1) return false;
    }
    return diffs === 1;
  }

  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < longer.length && j < shorter.length) {
    if (longer[i] === shorter[j]) {
      i++;
      j++;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    i++;
  }
  return true;
}

/**
 * Return the single candidate within edit distance 1 of `normalized`, or null.
 *
 * Candidates are expected to be already-normalised stored references. When more
 * than one candidate is equally close we return null — suggestions are surfaced
 * to a human operator and must never be auto-applied.
 */
export function suggestNearMatch(normalized: string, candidates: string[]): string | null {
  if (!normalized) return null;
  let match: string | null = null;
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    if (!isEditDistanceOne(normalized, candidate)) continue;
    if (match !== null) return null; // ambiguous
    match = candidate;
  }
  return match;
}
