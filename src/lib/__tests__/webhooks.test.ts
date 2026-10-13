import { describe, it, expect } from "vitest";
import { buildSignatureHeader, signWebhook, verifySignatureHeader } from "../webhooks/sign";
import { RETRY_SCHEDULE_SECONDS, nextRetryDelaySeconds } from "../webhooks/retry";

describe("webhook signature", () => {
  it("builds a `t=<unix>,v1=<hex>` header", async () => {
    const header = await buildSignatureHeader("secret", JSON.stringify({ a: 1 }));
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it("verifies a fresh header and rejects tampering", async () => {
    const secret = "shhh";
    const body = JSON.stringify({ a: 1 });
    const t = Math.floor(Date.now() / 1000);
    const header = `t=${t},v1=${await signWebhook(secret, t, body)}`;

    await expect(verifySignatureHeader(secret, header, body)).resolves.toBe(true);
    await expect(verifySignatureHeader(secret, header, body + " ")).resolves.toBe(false);
    await expect(verifySignatureHeader("other-secret", header, body)).resolves.toBe(false);
    await expect(verifySignatureHeader("other-secret", "malformed", body)).resolves.toBe(false);
  });
});

describe("webhook retry schedule", () => {
  it("is 10s,1m,5m,30m,2h,6h,24h then exhausted (→ failed)", () => {
    expect(RETRY_SCHEDULE_SECONDS).toEqual([10, 60, 300, 1800, 7200, 21600, 86400]);
    expect(nextRetryDelaySeconds(1)).toBe(10);
    expect(nextRetryDelaySeconds(7)).toBe(86400);
    expect(nextRetryDelaySeconds(8)).toBeNull();
  });
});
