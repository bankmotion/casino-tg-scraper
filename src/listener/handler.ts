import type { NewMessageEvent } from "telegram/events/index.js";
import type { TelegramClient, Api } from "telegram";
import { logger } from "../logger.js";
import { stats } from "../stats.js";
import { Queue } from "../backend/queue.js";
import { prefilter } from "./prefilter.js";
import { classify } from "./classifier.js";
import { downloadAndUpload } from "./cloudinary.js";
import type { ChannelEntity } from "./channels.js";

function mediaTypeOf(message: Api.Message): string | null {
  const media = message.media;
  if (!media) return null;
  const cls = (media as any).className || media.constructor.name;
  if (cls === "MessageMediaPhoto") return "photo";
  if (cls === "MessageMediaDocument") {
    const mime: string = (media as any).document?.mimeType || "";
    if (mime.startsWith("video/")) return "video";
    return "document";
  }
  return null;
}

function serializeRaw(msg: Api.Message): unknown {
  try {
    return JSON.parse(
      JSON.stringify(msg, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
    );
  } catch {
    return null;
  }
}

export function buildHandler(client: TelegramClient, queue: Queue) {
  return async function onMessage(entity: ChannelEntity, event: NewMessageEvent) {
    const msg = event.message;
    const text = msg.message || null;
    const mediaType = mediaTypeOf(msg);

    // Stage 1: cheap codebase-side pre-filter
    const pre = prefilter(text);
    if (!pre.pass) {
      logger.debug(
        { channel: entity.def.username, messageId: msg.id },
        "Dropped at pre-filter"
      );
      return;
    }
    logger.debug(
      { channel: entity.def.username, messageId: msg.id, reasons: pre.reasons },
      "Passed pre-filter"
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

    if (!classification.is_promo) {
      logger.debug(
        {
          channel: entity.def.username,
          messageId: msg.id,
          confidence: classification.confidence,
        },
        "Classified as non-promo — dropping"
      );
      return;
    }

    // Stage 3: media upload (only for confirmed promos)
    let mediaUpload = null;
    if (mediaType && msg.media) {
      mediaUpload = await downloadAndUpload(
        client,
        msg,
        entity.def.username,
        msg.id,
        mediaType
      );
    }

    // Stage 4: enqueue for backend POST
    const payload = {
      channel_id: entity.telegramId,
      channel_username: entity.def.username,
      channel_title: entity.def.title,
      message_id: msg.id,
      text,
      media_type: mediaType,
      media_url: mediaUpload?.url ?? null,
      media_thumb_url: mediaUpload?.thumb_url ?? null,
      media_width: mediaUpload?.width ?? null,
      media_height: mediaUpload?.height ?? null,
      posted_at: new Date(msg.date * 1000).toISOString(),
      classification,
      raw: serializeRaw(msg),
    };

    await queue.enqueue(payload, `${entity.def.id}_${msg.id}`);
    stats.recordPromo(entity.def.username || entity.def.title);

    logger.info(
      {
        channel: entity.def.username,
        messageId: msg.id,
        code: classification.code,
        confidence: classification.confidence,
      },
      "Promo queued"
    );
  };
}
