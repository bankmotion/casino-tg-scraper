import OpenAI from "openai";
import { config } from "../config.js";
import { logger } from "../logger.js";

const openai = new OpenAI({ apiKey: config.openai.apiKey });

export interface Classification {
  is_promo: boolean;
  confidence: number;
  code: string | null;
  summary: string | null;
}

const SYSTEM_PROMPT = `You classify Telegram messages from casino / gambling channels.

A "promo" message advertises a bonus, deposit offer, promo code, free spins, cashback, rakeback, giveaway, or similar incentive that a reader can act on.

NOT a promo: general chat, casino news, results, memes, screenshots without an offer, or any non-actionable post.

Rules:
- If a bonus / promo code is present (typically an uppercase token of 4-15 chars), extract it into "code".
- "summary" is a short one-line description of the offer (or null if not a promo).
- "confidence" is your certainty that this is a promo, 0..1.
- If the message is unclear or ambiguous, set is_promo=false.`;

const SCHEMA = {
  type: "object",
  properties: {
    is_promo: { type: "boolean" },
    confidence: { type: "number" },
    code: { type: ["string", "null"] },
    summary: { type: ["string", "null"] },
  },
  required: ["is_promo", "confidence", "code", "summary"],
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
