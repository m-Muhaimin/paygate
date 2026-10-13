import { describe, expect, it } from "vitest";

import {
  DEFAULT_FEE_RATE_BPS,
  bdtFromPaisa,
  computeFee,
  computeNet,
  formatBdt,
  formatBdtCompact,
  paisaFromBdt,
} from "@/lib/domain/money";

describe("paisa <-> BDT conversion", () => {
  it("converts BDT to integer paisa", () => {
    expect(paisaFromBdt(1200)).toBe(120000);
    expect(paisaFromBdt(12.34)).toBe(1234);
    expect(paisaFromBdt(0.01)).toBe(1);
    expect(paisaFromBdt(1.5)).toBe(150);
  });

  it("converts paisa back to BDT", () => {
    expect(bdtFromPaisa(120000)).toBe(1200);
    expect(bdtFromPaisa(1234)).toBe(12.34);
    expect(bdtFromPaisa(0)).toBe(0);
  });
});

describe("formatting", () => {
  it("formats full Tk amounts with grouping and 2 decimals", () => {
    expect(formatBdt(120000)).toBe("Tk 1,200.00");
    expect(formatBdt(1234)).toBe("Tk 12.34");
    expect(formatBdt(0)).toBe("Tk 0.00");
  });

  it("formats compact Tk amounts", () => {
    expect(formatBdtCompact(120000)).toBe("Tk 1.2K");
    expect(formatBdtCompact(100000000)).toBe("Tk 1M");
    expect(formatBdtCompact(0)).toBe("Tk 0");
  });
});

describe("fee model (5%)", () => {
  it("defaults to 500 bps", () => {
    expect(DEFAULT_FEE_RATE_BPS).toBe(500);
  });

  it("computes Tk 1,200 fee and net exactly", () => {
    expect(computeFee(120000, DEFAULT_FEE_RATE_BPS)).toBe(6000);
    expect(computeNet(120000, DEFAULT_FEE_RATE_BPS)).toBe(114000);
  });

  it("rounds to the nearest paisa", () => {
    // 99 * 5% = 4.95 -> 5; 101 * 5% = 5.05 -> 5
    expect(computeFee(99, 500)).toBe(5);
    expect(computeFee(101, 500)).toBe(5);
    // 10 * 5% = 0.5 -> 1
    expect(computeFee(10, 500)).toBe(1);
  });

  it("never loses or invents paisa", () => {
    for (const amount of [1, 99, 101, 120000, 999999, 123456789]) {
      expect(computeFee(amount, 500) + computeNet(amount, 500)).toBe(amount);
    }
  });
});
