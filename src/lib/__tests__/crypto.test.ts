import { describe, expect, it } from "vitest";

import {
  buildSignatureHeader,
  generateToken,
  hashSecret,
  signWebhook,
  timingSafeEqualHex,
  verifySecret,
  verifySignatureHeader,
} from "@/lib/api/crypto";

describe("hashSecret / verifySecret", () => {
  it("produces a deterministic 64-char SHA-256 hex digest", async () => {
    const hash = await hashSecret("device-secret");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashSecret("device-secret")).toBe(hash);
  });

  it("verifies the matching secret and rejects others", async () => {
    const hash = await hashSecret("sk_live_example");
    expect(await verifySecret("sk_live_example", hash)).toBe(true);
    expect(await verifySecret("sk_live_wrong", hash)).toBe(false);
    expect(await verifySecret("sk_live_exampl3", hash)).toBe(false);
  });
});

describe("timingSafeEqualHex", () => {
  it("compares equal-length hex constant-time", () => {
    expect(timingSafeEqualHex("a1b2c3", "a1b2c3")).toBe(true);
    expect(timingSafeEqualHex("a1b2c3", "a1b2c4")).toBe(false);
    expect(timingSafeEqualHex("a1b2c3", "a1b2")).toBe(false);
  });
});

describe("generateToken", () => {
  it("returns 256 bits of hex by default", () => {
    const token = generateToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("honours a custom byte length and is not predictable", () => {
    expect(generateToken(16)).toHaveLength(32);
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()));
    expect(tokens.size).toBe(100);
  });
});

describe("webhook signatures", () => {
  const secret = "whsec_test_123";
  const body = JSON.stringify({ event_id: "evt_1", type: "payment.paid" });

  it("round-trips sign -> verify", async () => {
    const header = await buildSignatureHeader(secret, body);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(await verifySignatureHeader(secret, header, body)).toBe(true);
  });

  it("produces a stable v1 for a fixed timestamp", async () => {
    const a = await signWebhook(secret, 1700000000, body);
    const b = await signWebhook(secret, 1700000000, body);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("rejects tampered bodies, headers and secrets", async () => {
    const header = await buildSignatureHeader(secret, body);

    expect(await verifySignatureHeader(secret, header, `${body} `)).toBe(false);

    const tampered = header.replace(/v1=./, "v1=0");
    expect(await verifySignatureHeader(secret, tampered, body)).toBe(false);

    expect(await verifySignatureHeader("whsec_other", header, body)).toBe(false);
  });

  it("rejects malformed headers", async () => {
    expect(await verifySignatureHeader(secret, "", body)).toBe(false);
    expect(await verifySignatureHeader(secret, "v1=deadbeef", body)).toBe(false);
    expect(await verifySignatureHeader(secret, "t=abc,v1=deadbeef", body)).toBe(false);
  });

  it("rejects stale or future timestamps beyond the tolerance window", async () => {
    const now = Math.floor(Date.now() / 1000);
    const stale = now - 600;
    const staleHeader = `t=${stale},v1=${await signWebhook(secret, stale, body)}`;
    expect(await verifySignatureHeader(secret, staleHeader, body)).toBe(false);
    // same signature verifies when the tolerance is widened
    expect(await verifySignatureHeader(secret, staleHeader, body, 3600)).toBe(true);

    const future = now + 600;
    const futureHeader = `t=${future},v1=${await signWebhook(secret, future, body)}`;
    expect(await verifySignatureHeader(secret, futureHeader, body)).toBe(false);
  });
});
