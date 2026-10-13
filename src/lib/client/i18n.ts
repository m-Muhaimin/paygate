/**
 * Native EN / বাংলা copy for the hosted pay page.
 *
 * These strings are authored by hand (not machine-translated) so the Bangla
 * reads naturally. Bangla gets the `font-gate-bn` treatment (Noto Sans Bengali
 * plus a taller line-height) at the page root.
 */

import type { Provider, ReviewReason } from "@/lib/client/query";

import { localizeDigits } from "./format";

export type Lang = "en" | "bn";

export const PROVIDER_LABELS: Record<Provider, string> = {
  bkash: "bKash",
  nagad: "Nagad",
  rocket: "Rocket",
};

export type PayCopy = {
  langLabel: string;
  langEnglish: string;
  langBangla: string;
  secureNote: string;

  amountLabel: string;

  waitingTitle: string;
  waitingIntro: string;
  sendTo: (provider: string) => string;
  holderLabel: string;
  walletUnavailable: string;
  copyLabel: string;
  copiedLabel: string;
  referenceLabel: string;
  referenceHelp: string;
  referenceWarning: string;
  countdownLabel: string;
  countdownExpired: string;

  trxTitle: string;
  trxLabel: string;
  trxPlaceholder: string;
  trxStart: string;
  confirmCta: string;
  confirmHelp: string;
  trxInvalid: string;
  trxGenericError: string;
  attemptsLeft: (n: number) => string;

  verifyingTitle: string;
  verifyingBody: string;
  confirmingTitle: string;
  confirmingBody: string;
  orderIdLabel: string;

  paidTitle: string;
  paidBody: string;
  paidAnnounce: string;

  expiredTitle: string;
  expiredBody: string;
  cancelledTitle: string;
  cancelledBody: string;

  reviewTitle: string;
  reviewHeld: string;
  reviewMismatch: (received: string, expected: string) => string;
  reviewReassure: string;
  reviewReasons: Record<ReviewReason, string>;

  lockoutTitle: string;
  lockoutBody: string;
  lockoutLabel: string;

  trxUsedTitle: string;
  trxUsedBody: string;
  trxUsedRetry: string;

  backToShop: string;

  loadingLabel: string;
  errorTitle: string;
  errorRetry: string;

  invalidTitle: string;
  invalidBody: string;
  invalidHome: string;

  minutesRemaining: (n: number) => string;
  lessThanMinute: string;
};

const en: PayCopy = {
  langLabel: "Language",
  langEnglish: "EN",
  langBangla: "বাংলা",
  secureNote: "Verified securely by PayGate",

  amountLabel: "Amount",

  waitingTitle: "Complete your payment",
  waitingIntro:
    "Send money from your wallet app, then keep this page open. It updates on its own.",
  sendTo: (provider) => `Send Money to this ${provider} number`,
  holderLabel: "Account name",
  walletUnavailable:
    "This payment has no receiving wallet assigned right now. Please wait a moment and refresh.",
  copyLabel: "Copy",
  copiedLabel: "Copied",
  referenceLabel: "Your reference",
  referenceHelp:
    "Write this code in the Reference (or Note) field of the Send Money screen.",
  referenceWarning:
    "Payments without a matching reference can take longer to confirm.",
  countdownLabel: "Time left to pay",
  countdownExpired: "Time is up",

  trxTitle: "Confirm with your TrxID",
  trxLabel: "TrxID",
  trxPlaceholder: "e.g. 9A1B2C3D4E",
  trxStart: "I've sent the money",
  confirmCta: "Confirm Payment",
  confirmHelp:
    "Open the transaction details in your wallet app, copy the TrxID, then press Confirm Payment.",
  trxInvalid:
    "Enter the TrxID exactly as shown in your wallet app (6 to 24 letters and numbers).",
  trxGenericError: "We could not confirm your payment. Please try again.",
  attemptsLeft: (n) => `${n} ${n === 1 ? "attempt" : "attempts"} remaining`,

  verifyingTitle: "Verifying your payment with the network…",
  verifyingBody: "Keep this page open. This can take up to a minute.",
  confirmingTitle: "Still checking. This can take a minute.",
  confirmingBody:
    "We have not matched the payment yet. Keep this page open and it will update on its own.",
  orderIdLabel: "Order ID",

  paidTitle: "Payment Received",
  paidBody: "Thank you. Your payment has been confirmed.",
  paidAnnounce: "Payment confirmed.",

  expiredTitle: "This payment link has expired",
  expiredBody:
    "The time to pay ran out. Ask the merchant for a fresh link to try again.",

  cancelledTitle: "This payment was cancelled",
  cancelledBody:
    "The merchant cancelled this request. Contact the merchant if you still want to pay.",

  reviewTitle: "We are confirming your payment",
  reviewHeld:
    "We received your payment and our team is reviewing it now. You do not need to pay again.",
  reviewMismatch: (received, expected) =>
    `We received ${received} but expected ${expected}. Our team is reviewing it.`,
  reviewReassure: "You do not need to pay again.",
  reviewReasons: {
    underpaid: "The amount received was less than expected.",
    overpaid: "The amount received was more than expected.",
    wrong_wallet: "The payment went to a different wallet.",
    late_payment: "The payment arrived after the link expired.",
    duplicate_ref: "This reference was already used.",
    conflict: "The reference and TrxID point to different payments.",
    unmatched: "We could not match this payment automatically.",
  },

  lockoutTitle: "Too many attempts",
  lockoutBody:
    "For your security this page is locked for 15 minutes. Please wait, then try again, or ask the merchant for a new link.",
  lockoutLabel: "Locked for",

  trxUsedTitle: "This TrxID was already used",
  trxUsedBody:
    "That TrxID is linked to another payment. Check your wallet app and enter the correct TrxID.",
  trxUsedRetry: "Try another TrxID",

  backToShop: "Back to Shop",

  loadingLabel: "Loading payment details",
  errorTitle: "We could not load this payment",
  errorRetry: "Try again",

  invalidTitle: "This link is not valid",
  invalidBody:
    "This payment link is wrong or no longer available. Contact the merchant for a new link.",
  invalidHome: "Go to PayGate",

  minutesRemaining: (n) => `${n} ${n === 1 ? "minute" : "minutes"} left`,
  lessThanMinute: "Less than a minute left",
};

const bn: PayCopy = {
  langLabel: "ভাষা",
  langEnglish: "EN",
  langBangla: "বাংলা",
  secureNote: "PayGate নিরাপদে যাচাই করে",

  amountLabel: "পরিমাণ",

  waitingTitle: "পেমেন্ট সম্পন্ন করুন",
  waitingIntro:
    "আপনার ওয়ালেট অ্যাপ থেকে Send Money করুন, তারপর এই পেজটি খোলা রাখুন। এটি নিজে থেকেই আপডেট হবে।",
  sendTo: (provider) => `${provider} নম্বরে Send Money করুন`,
  holderLabel: "অ্যাকাউন্টের নাম",
  walletUnavailable:
    "এই পেমেন্টের জন্য এখন কোনো ওয়ালেট নম্বর নেই। একটু পরে পেজটি রিফ্রেশ করুন।",
  copyLabel: "কপি",
  copiedLabel: "কপি হয়েছে",
  referenceLabel: "আপনার রেফারেন্স",
  referenceHelp:
    "Send Money স্ক্রিনের Reference বা নোট ঘরে এই কোডটি লিখুন।",
  referenceWarning:
    "রেফারেন্স ঠিকভাবে না দিলে পেমেন্ট নিশ্চিত হতে বেশি সময় লাগতে পারে।",
  countdownLabel: "পেমেন্টের সময় বাকি",
  countdownExpired: "সময় শেষ",

  trxTitle: "TrxID দিয়ে নিশ্চিত করুন",
  trxLabel: "TrxID",
  trxPlaceholder: "যেমন 9A1B2C3D4E",
  trxStart: "টাকা পাঠিয়েছি",
  confirmCta: "পেমেন্ট নিশ্চিত করুন",
  confirmHelp:
    "ওয়ালেট অ্যাপের ট্রানজেকশন বিবরণ খুলে TrxID কপি করুন, তারপর পেমেন্ট নিশ্চিত করুন চাপুন।",
  trxInvalid:
    "ওয়ালেট অ্যাপে যে TrxID দেখাচ্ছে ঠিক সেটিই দিন (৬ থেকে ২৪টি অক্ষর বা সংখ্যা)।",
  trxGenericError: "পেমেন্ট নিশ্চিত করা যায়নি। আবার চেষ্টা করুন।",
  attemptsLeft: (n) => `${localizeDigits(String(n), "bn")}টি চেষ্টা বাকি`,

  verifyingTitle: "নেটওয়ার্কের সাথে আপনার পেমেন্ট যাচাই করা হচ্ছে…",
  verifyingBody: "পেজটি খোলা রাখুন। এক মিনিট পর্যন্ত লাগতে পারে।",
  confirmingTitle: "এখনও যাচাই চলছে। এক মিনিট লাগতে পারে।",
  confirmingBody:
    "এখনও পেমেন্ট মেলানো যায়নি। পেজটি খোলা রাখলে নিজে থেকেই আপডেট হবে।",
  orderIdLabel: "অর্ডার আইডি",

  paidTitle: "পেমেন্ট পেয়েছি",
  paidBody: "ধন্যবাদ। আপনার পেমেন্ট নিশ্চিত হয়েছে।",
  paidAnnounce: "পেমেন্ট নিশ্চিত হয়েছে।",

  expiredTitle: "এই পেমেন্ট লিংকের সময় শেষ",
  expiredBody:
    "পেমেন্টের সময় শেষ হয়ে গেছে। আবার চেষ্টা করতে বিক্রেতার কাছে নতুন লিংক চান।",

  cancelledTitle: "এই পেমেন্টটি বাতিল হয়েছে",
  cancelledBody:
    "বিক্রেতা এই অনুরোধটি বাতিল করেছেন। এখনও পেমেন্ট করতে চাইলে বিক্রেতার সাথে যোগাযোগ করুন।",

  reviewTitle: "আপনার পেমেন্ট যাচাই করা হচ্ছে",
  reviewHeld:
    "আমরা আপনার পেমেন্ট পেয়েছি এবং এখন যাচাই করছি। আবার পেমেন্ট করার দরকার নেই।",
  reviewMismatch: (received, expected) =>
    `আমরা ${received} পেয়েছি, কিন্তু প্রত্যাশা ছিল ${expected}। আমাদের দল এটি যাচাই করছে।`,
  reviewReassure: "আবার পেমেন্ট করার দরকার নেই।",
  reviewReasons: {
    underpaid: "প্রাপ্ত টাকা প্রত্যাশার চেয়ে কম।",
    overpaid: "প্রাপ্ত টাকা প্রত্যাশার চেয়ে বেশি।",
    wrong_wallet: "পেমেন্টটি অন্য ওয়ালেটে গেছে।",
    late_payment: "লিংকের সময় শেষ হওয়ার পর পেমেন্ট এসেছে।",
    duplicate_ref: "এই রেফারেন্স আগেই ব্যবহৃত হয়েছে।",
    conflict: "রেফারেন্স ও TrxID ভিন্ন ভিন্ন পেমেন্টে নির্দেশ করছে।",
    unmatched: "পেমেন্টটি স্বয়ংক্রিয়ভাবে মেলানো যায়নি।",
  },

  lockoutTitle: "অনেকবার চেষ্টা করা হয়েছে",
  lockoutBody:
    "নিরাপত্তার জন্য এই পেজটি ১৫ মিনিটের জন্য বন্ধ রাখা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন, বা বিক্রেতার কাছে নতুন লিংক চান।",
  lockoutLabel: "বন্ধ আছে",

  trxUsedTitle: "এই TrxID আগেই ব্যবহৃত হয়েছে",
  trxUsedBody:
    "এই TrxID অন্য একটি পেমেন্টের সাথে যুক্ত। ওয়ালেট অ্যাপে দেখে সঠিক TrxID দিন।",
  trxUsedRetry: "অন্য TrxID দিন",

  backToShop: "দোকানে ফিরুন",

  loadingLabel: "পেমেন্টের তথ্য লোড হচ্ছে",
  errorTitle: "পেমেন্টের তথ্য আনা যায়নি",
  errorRetry: "আবার চেষ্টা করুন",

  invalidTitle: "লিংকটি সঠিক নয়",
  invalidBody:
    "এই পেমেন্ট লিংকটি ভুল বা আর ব্যবহারযোগ্য নয়। নতুন লিংকের জন্য বিক্রেতার সাথে যোগাযোগ করুন।",
  invalidHome: "PayGate-এ যান",

  minutesRemaining: (n) => `${localizeDigits(String(n), "bn")} মিনিট বাকি`,
  lessThanMinute: "এক মিনিটেরও কম সময় বাকি",
};

export const DICTIONARIES: Record<Lang, PayCopy> = { en, bn };
