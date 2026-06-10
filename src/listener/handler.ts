import type { NewMessageEvent } from "telegram/events/index.js";
import type { Api } from "telegram";
import { logger } from "../logger.js";
import { stats } from "../stats.js";
import { publish as publishFeed } from "../feed.js";
import { Queue } from "../backend/queue.js";
import { prefilter } from "./prefilter.js";
import { classify } from "./classifier.js";
import type { ChannelEntity } from "./channels.js";

// Anything below this OpenAI confidence is treated as "not a promo" and dropped.
const PROMO_CONFIDENCE_THRESHOLD = 0.5;

function serializeRaw(msg: Api.Message): unknown {
  try {
    return JSON.parse(
      JSON.stringify(msg, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
    );
  } catch {
    return null;
  }
}

export function buildHandler(queue: Queue) {
  return async function onMessage(entity: ChannelEntity, event: NewMessageEvent) {
    const msg = event.message;
    const text = msg.message || null;
    const channel = entity.def.username || entity.def.title;
    const preview = text
      ? text.replace(/\s+/g, " ").slice(0, 80) + (text.length > 80 ? "…" : "")
      : "(no text / media only)";

    logger.info({ channel, messageId: msg.id, preview }, "📥 Message received");

    // Stage 1: cheap codebase-side pre-filter
    const pre = prefilter(text);
    if (!pre.pass) {
      logger.info(
        { channel, messageId: msg.id },
        "🗑  Dropped at pre-filter (no promo cues)"
      );
      return;
    }
    logger.info(
      { channel, messageId: msg.id, reasons: pre.reasons },
      "✓ Passed pre-filter, calling OpenAI"
    );

    // Stage 2: OpenAI promo classification
    let classification;
    try {
      stats.recordOpenAiCall();
      classification = await classify(text || "");
    } catch (err) {
      logger.error({ err, messageId: msg.id }, "Classifier failed — dropping message");
      return;
    }

    if (classification.confidence < PROMO_CONFIDENCE_THRESHOLD) {
      logger.info(
        {
          channel,
          messageId: msg.id,
          confidence: classification.confidence,
        },
        "🗑  OpenAI says not a promo — dropping"
      );
      return;
    }

    // Stage 3: enqueue for backend POST
    const payload = {
      channel_id: entity.telegramId,
      channel_username: entity.def.username,
      channel_title: entity.def.title,
      partner_id: entity.def.partner_id,
      message_id: msg.id,
      text,
      classification: {
        timestamp: new Date(msg.date * 1000).toISOString(),
        ...classification,
      },
      raw: serializeRaw(msg),
    };

    await queue.enqueue(payload, `${entity.def.id}_${msg.id}`);
    stats.recordPromo(entity.def.username || entity.def.title);

    // Fire-and-forget live mirror to the feed channel (no-op if FEED_TELEGRAM_CHAT_ID is unset)
    void publishFeed(payload);

    logger.info(
      {
        channel,
        messageId: msg.id,
        code: classification.code,
        confidence: classification.confidence,
      },
      "🎁 Promo queued"
    );
  };
}
