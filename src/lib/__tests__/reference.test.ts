import { describe, expect, it } from "vitest";

import {
  LOOKALIKE_CHARS,
  REFERENCE_CHARSET,
  REFERENCE_LENGTH,
  generateReference,
  isValidReference,
  normalizeReference,
  suggestNearMatch,
} from "@/lib/domain/reference";

function differentChar(original: string): string {
  for (const ch of REFERENCE_CHARSET) {
    if (ch !== original) return ch;
  }
  throw new Error("charset exhausted");
}

describe("reference charset", () => {
  it("is 31 chars and excludes every look-alike", () => {
    expect(REFERENCE_CHARSET).toHaveLength(31);
    expect(REFERENCE_LENGTH).toBe(8);
    for (const lookalike of LOOKALIKE_CHARS) {
      expect(REFERENCE_CHARSET).not.toContain(lookalike);
    }
  });
});

describe("generateReference", () => {
  it("produces valid, uppercase, 8-char references", () => {
    for (let i = 0; i < 1000; i++) {
      const ref = generateReference();
      expect(ref).toHaveLength(REFERENCE_LENGTH);
      expect(ref).toBe(ref.toUpperCase());
      expect(isValidReference(ref)).toBe(true);
    }
  });

  it("never contains look-alike characters", () => {
    for (let i = 0; i < 1000; i++) {
      const ref = generateReference();
      for (const lookalike of LOOKALIKE_CHARS) {
        expect(ref).not.toContain(lookalike);
      }
    }
  });
});

describe("check char integrity", () => {
  it("rejects a single-character substitution across 1000 random refs", () => {
    for (let n = 0; n < 1000; n++) {
      const ref = generateReference();
      const position = n % REFERENCE_LENGTH;
      const typo =
        ref.slice(0, position) + differentChar(ref[position]) + ref.slice(position + 1);
      expect(typo).not.toBe(ref);
      expect(isValidReference(typo)).toBe(false);
    }
  });

  it("rejects an adjacent transposition across 1000 random refs", () => {
    for (let n = 0; n < 1000; n++) {
      const ref = generateReference();
      // Find an adjacent pair inside the 7-char data section whose chars differ.
      let swapAt = -1;
      for (let i = 0; i < REFERENCE_LENGTH - 2; i++) {
        if (ref[i] !== ref[i + 1]) {
          swapAt = i;
          break;
        }
      }
      if (swapAt === -1) continue; // all-equal data section; transposition is a no-op
      const swapped =
        ref.slice(0, swapAt) +
        ref[swapAt + 1] +
        ref[swapAt] +
        ref.slice(swapAt + 2);
      expect(swapped).not.toBe(ref);
      expect(isValidReference(swapped)).toBe(false);
    }
  });
});

describe("normalizeReference", () => {
  it("strips a leading REF token and surrounding noise", () => {
    expect(normalizeReference("REF934P923")).toBe("934P923");
    expect(normalizeReference("  ref 934-p923 ")).toBe("934P923");
    expect(normalizeReference("Ref: 934 P923")).toBe("934P923");
  });

  it("uppercases and removes non-charset characters", () => {
    expect(normalizeReference("ab-cd 2 3")).toBe("ABCD23");
    expect(normalizeReference("O0I1L")).toBe("");
    expect(normalizeReference("")).toBe("");
  });

  it("never mangles a generated reference that begins with REF", () => {
    // The REF-strip guard must preserve genuine full-length references.
    expect(normalizeReference("REF9P234")).toBe("REF9P234");
  });

  it("round-trips every generated reference", () => {
    for (let i = 0; i < 500; i++) {
      const ref = generateReference();
      expect(normalizeReference(ref)).toBe(ref);
    }
  });
});

describe("isValidReference", () => {
  const valid = generateReference();

  it("accepts a valid reference regardless of case or separators", () => {
    expect(isValidReference(valid)).toBe(true);
    expect(isValidReference(valid.toLowerCase())).toBe(true);
    expect(isValidReference(` ${valid.slice(0, 4)}-${valid.slice(4)} `)).toBe(true);
  });

  it("rejects wrong length and bad check chars", () => {
    expect(isValidReference(valid.slice(0, 7))).toBe(false);
    expect(isValidReference(`${valid}9`)).toBe(false);
    expect(isValidReference("")).toBe(false);
    const badCheck = valid.slice(0, 7) + differentChar(valid[7]);
    expect(isValidReference(badCheck)).toBe(false);
  });
});

describe("suggestNearMatch", () => {
  const candidate = "23456789";

  it("returns the one candidate within edit distance 1", () => {
    expect(suggestNearMatch("2345678A", [candidate])).toBe(candidate); // substitution
    expect(suggestNearMatch("2345678", [candidate])).toBe(candidate); // insertion
    expect(suggestNearMatch("234567890", [candidate])).toBe(candidate); // deletion
  });

  it("returns null when no candidate is close", () => {
    expect(suggestNearMatch("99999999", [candidate])).toBeNull();
    expect(suggestNearMatch(candidate, [candidate])).toBeNull(); // exact match is not a suggestion
    expect(suggestNearMatch("", [candidate])).toBeNull();
  });

  it("returns null when the nearest match is ambiguous", () => {
    expect(suggestNearMatch("2345678B", ["23456789", "2345678A"])).toBeNull();
  });
});
