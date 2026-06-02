const PROMO_KEYWORDS = [
  "bonus",
  "promo",
  "code",
  "free spin",
  "freespin",
  "deposit",
  "claim",
  "reward",
  "rakeback",
  "cashback",
  "wager",
  "jackpot",
  "giveaway",
  "raffle",
  "no deposit",
  "welcome",
  "exclusive",
  "limited",
  "drop",
  "airdrop",
  "promotion",
  "code:",
];

// Promo-style emojis frequently used in casino channels.
const PROMO_EMOJIS =
  /[\u{1F381}\u{1F4B0}\u{1F3B0}\u{1F48E}\u{1F525}\u{1F3AF}\u{1F193}⚡\u{1F389}\u{1F4B8}\u{1F4B5}\u{1F3B2}\u{1F0CF}]/u;

const URL_RE = /https?:\/\/\S+/i;
const TG_LINK = /t\.me\/\S+/i;

const TOKEN_CHARS = /^[A-Za-z0-9_-]+$/;
const HAS_LETTER = /[A-Za-z]/;
const HAS_DIGIT_OR_SEP = /[\d_-]/;

/**
 * Promo codes vary wildly in shape:
 *   WELCOME200, K15HMK, rainx5-8yii, BL_CKJ_CK-05-m8k2, 678D7QJW
 * Common traits: a 5-25 char token of [A-Za-z0-9_-] containing at least one
 * letter AND at least one digit or separator. Excludes plain English words
 * ("welcome", "casino") because those have neither digits nor separators.
 */
function looksLikePromoCode(text: string): boolean {
  for (const raw of text.split(/\s+/)) {
    const token = raw.replace(/^[^A-Za-z0-9_-]+|[^A-Za-z0-9_-]+$/g, "");
    if (token.length < 5 || token.length > 25) continue;
    if (!TOKEN_CHARS.test(token)) continue;
    if (!HAS_LETTER.test(token)) continue;
    if (!HAS_DIGIT_OR_SEP.test(token)) continue;
    return true;
  }
  return false;
}

export interface PrefilterResult {
  pass: boolean;
  reasons: string[];
}

export function prefilter(text: string | null): PrefilterResult {
  if (!text) return { pass: false, reasons: ["empty"] };

  const lower = text.toLowerCase();
  const reasons: string[] = [];

  for (const kw of PROMO_KEYWORDS) {
    if (lower.includes(kw)) {
      reasons.push(`kw:${kw}`);
      break;
    }
  }
  if (looksLikePromoCode(text)) reasons.push("code");
  if (URL_RE.test(text) || TG_LINK.test(text)) reasons.push("url");
  if (PROMO_EMOJIS.test(text)) reasons.push("emoji");

  return { pass: reasons.length > 0, reasons };
}
