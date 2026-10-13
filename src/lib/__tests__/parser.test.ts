import { describe, it, expect } from "vitest";
import { parseSms, PARSER_VERSION, extractTrxId, detectProvider } from "../sms/parser";
import { generateReference } from "@/lib/domain/reference";

const REF_SMS =
  "You have received Tk 1,200.00 from 01712750278. Fee Tk 0.00. Balance Tk 1,200.00. TrxID DJC9SZQV0J and Ref REF934P923 at 12/10/2026 15:24";

describe("sms parser", () => {
  it("parses the canonical bKash reference SMS", () => {
    const r = parseSms({ sender: "bKash", body: REF_SMS });
    expect(r).not.toBeNull();
    expect(r).toMatchObject({
      trxId: "DJC9SZQV0J",
      amountPaisa: 120000,
      feePaisa: 0,
      balanceAfterPaisa: 120000,
      refRaw: "REF934P923",
      phone: "01712750278",
      parserVersion: PARSER_VERSION,
    });
    // "934P923" normalises to 7 chars → not a valid reference → null, refRaw kept.
    expect(r!.refNormalized).toBeNull();
  });

  it("handles thousands separators, fees and large balances", () => {
    const r = parseSms({
      sender: "bKash",
      body: "You have received Tk 12,345.67 from 01812345678. Fee Tk 50.00. Balance Tk 1,00,000.00. TrxID ABC123XYZ9 Ref 23456789 at 1/1/2027 09:05",
    });
    expect(r).toMatchObject({ amountPaisa: 1234567, feePaisa: 5000 });
  });

  it("parses a Nagad wording variant", () => {
    const r = parseSms({
      sender: "NAGAD",
      body: "Money Received. Tk 1,200.00 received from 01712750278. Ref: REF934P923. Fee Tk 0.00. Balance Tk 1,200.00. TrxID: DJC9SZQV0J at 12/10/2026 15:24",
    });
    expect(r).toMatchObject({ trxId: "DJC9SZQV0J", amountPaisa: 120000, feePaisa: 0 });
  });

  it("parses a Nagad 'you have received' variant", () => {
    const r = parseSms({
      sender: "16216-NAGAD",
      body: "You have received Tk 500.00 from 01712750278. Fee Tk 0.00. Balance Tk 500.00. TrxID XYZ987ABC1 Ref 23456789 at 12/10/2026 15:24",
    });
    expect(r).toMatchObject({ amountPaisa: 50000, trxId: "XYZ987ABC1" });
  });

  it("parses a Rocket wording variant with TxnID", () => {
    const r = parseSms({
      sender: "16216",
      body: "You have received Tk 1,200.00 from 01712750278. Fee Tk 0.00. Balance Tk 1,200.00. TxnID RKT9988776 Ref 23456789 at 12/10/2026 15:24",
    });
    expect(r).toMatchObject({ amountPaisa: 120000, trxId: "RKT9988776" });
  });

  it("keeps a valid echoed reference (8-char check-valid)", () => {
    const ref = generateReference();
    const r = parseSms({
      sender: "bKash",
      body: `You have received Tk 100.00 from 01712750278. Fee Tk 0.00. Balance Tk 100.00. TrxID AAA111BBB2 Ref ${ref} at 12/10/2026 15:24`,
    });
    expect(r!.refRaw).toBe(ref);
    expect(r!.refNormalized).toBe(ref);
  });

  it("returns null for an outgoing/other message", () => {
    expect(
      parseSms({ sender: "bKash", body: "You have sent Tk 500.00 to 01711111111. Fee Tk 0.00." }),
    ).toBeNull();
  });

  it("returns null for garbage", () => {
    expect(parseSms({ sender: "bKash", body: "Your OTP is 1234. Do not share." })).toBeNull();
    expect(parseSms({ sender: "UNKNOWN", body: REF_SMS })).toBeNull();
  });
});

describe("parser helpers", () => {
  it("detectProvider maps sender ids (incl. providers from PROVIDERS metadata)", () => {
    expect(detectProvider("bKash")).toBe("bkash");
    expect(detectProvider("NAGAD")).toBe("nagad");
    expect(detectProvider("16216")).toBe("rocket");
    expect(detectProvider("some-bank")).toBeNull();
    expect(detectProvider("anything", "nagad")).toBe("nagad");
  });

  it("extractTrxId works even when the rest is unparseable", () => {
    expect(extractTrxId("TrxID DJC9SZQV0J blah blah")).toBe("DJC9SZQV0J");
    expect(extractTrxId("TxnID: abc123xyz9 ...")).toBe("ABC123XYZ9");
    expect(extractTrxId("no trx here")).toBeNull();
  });
});
