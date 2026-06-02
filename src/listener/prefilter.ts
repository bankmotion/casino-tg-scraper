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
  /[\u{1F381}\u{1F4B0}\u{1F3B0}\u{1F48E}\u{1F525}\u{1F3AF}\u{1F193}⚡\u{1F389}\u{1F4B8}\u{1F4B5}\u{1F3B2}]/u;

// Uppercase code-like token: 4-15 chars, mostly letters + digits, must contain at least one letter.
const CODE_TOKEN = /\b(?=[A-Z0-9]{4,15}\b)(?=[A-Z0-9]*[A-Z])[A-Z][A-Z0-9]{3,14}\b/;

const URL_RE = /https?:\/\/\S+/i;
const TG_LINK = /t\.me\/\S+/i;

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
  if (CODE_TOKEN.test(text)) reasons.push("code");
  if (URL_RE.test(text) || TG_LINK.test(text)) reasons.push("url");
  if (PROMO_EMOJIS.test(text)) reasons.push("emoji");

  return { pass: reasons.length > 0, reasons };
}
