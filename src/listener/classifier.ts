import OpenAI from "openai";
import { config } from "../config.js";
import { logger } from "../logger.js";

const openai = new OpenAI({ apiKey: config.openai.apiKey });

export interface Classification {
  confidence: number;
  code: string | null;
  summary: string | null;
  value_usd: number | null;
  wager_req_usd: number | null;
  claims_count: number | null;
}

const SYSTEM_PROMPT = `You classify Telegram messages from casino / gambling channels and extract structured fields.

A "promo" message advertises a bonus, deposit offer, promo code, free spins, cashback, rakeback, giveaway, or similar incentive that a reader can act on.

NOT a promo: general chat, casino news, results, memes, screenshots without an offer, or any non-actionable post.

"confidence" is your certainty that this is a promo, on a 0..1 scale:
- If you judge this is NOT a promo, set "confidence" to 0 and leave ALL other fields null.
- Otherwise "confidence" reflects how sure you are.

Extraction rules (set field to null if NOT clearly stated in the message):

- "code": the bonus / promo code as written, preserving case and punctuation (e.g. "WELCOME200", "BL_CKJ_CK-05-m8k2", "rainx5-8yii"). Do not invent codes.
- "summary": one short line describing the offer.
- "value_usd": numeric USD value of the bonus only if stated in USD ($ sign). "$5 value" -> 5. "$25 bonus" -> 25. "$1.5 free" -> 1.5. If the amount is in BTC / ETH / EUR / GBP / etc., set null.
- "wager_req_usd": USD wagering requirement only if stated in USD. "$15,000 wager required" -> 15000. "$75K" -> 75000. "$2.5k wager" -> 2500.
- "claims_count": integer count of claims/redemptions stated in the message (e.g. "200 claims" -> 200). Null if not stated.`;

const SCHEMA = {
  type: "object",
  properties: {
    confidence: { type: "number" },
    code: { type: ["string", "null"] },
    summary: { type: ["string", "null"] },
    value_usd: { type: ["number", "null"] },
    wager_req_usd: { type: ["number", "null"] },
    claims_count: { type: ["integer", "null"] },
  },
  required: [
    "confidence",
    "code",
    "summary",
    "value_usd",
    "wager_req_usd",
    "claims_count",
  ],
  additionalProperties: false,
} as const;

export async function classify(text: string): Promise<Classification> {
  const response = await openai.chat.completions.create({
    model: config.openai.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: text },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "promo_classification",
        strict: true,
        schema: SCHEMA as any,
      },
    },
    temperature: 0,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content");

  try {
    return JSON.parse(content) as Classification;
  } catch (err) {
    logger.error({ content }, "Failed to parse OpenAI JSON response");
    throw err;
  }
}
