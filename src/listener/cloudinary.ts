import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import type { TelegramClient, Api } from "telegram";
import { config } from "../config.js";
import { logger } from "../logger.js";

cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key: config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
  secure: true,
});

export interface MediaUpload {
  url: string;
  thumb_url: string | null;
  width: number | null;
  height: number | null;
}

function resourceTypeFor(mediaType: string): "image" | "video" | "raw" {
  if (mediaType === "photo") return "image";
  if (mediaType === "video") return "video";
  return "raw";
}

export async function downloadAndUpload(
  client: TelegramClient,
  message: Api.Message,
  channelUsername: string | null,
  messageId: number,
  mediaType: string
): Promise<MediaUpload | null> {
  if (!message.media) return null;

  let buffer: Buffer | null = null;
  try {
    const result = await client.downloadMedia(message, {});
    if (!result) return null;
    if (Buffer.isBuffer(result)) {
      buffer = result;
    } else if (typeof result === "string") {
      buffer = Buffer.from(result, "binary");
    } else {
      logger.warn({ messageId }, "Unexpected downloadMedia return type");
      return null;
    }
  } catch (err) {
    logger.error({ err, messageId }, "Telegram media download failed");
    return null;
  }

  const safeChannel = (channelUsername || "private").replace(/[^a-zA-Z0-9_-]/g, "");
  const publicId = `${safeChannel}_${messageId}`;
  const resourceType = resourceTypeFor(mediaType);

  try {
    const uploaded = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: config.cloudinary.folder,
          public_id: publicId,
          resource_type: resourceType,
          overwrite: false,
        },
        (err, res) => {
          if (err || !res) return reject(err || new Error("Empty Cloudinary response"));
          resolve(res);
        }
      );
      stream.end(buffer);
    });

    const thumbUrl =
      uploaded.resource_type === "video"
        ? cloudinary.url(`${uploaded.public_id}.jpg`, {
            resource_type: "video",
            secure: true,
          })
        : null;

    return {
      url: uploaded.secure_url,
      thumb_url: thumbUrl,
      width: uploaded.width ?? null,
      height: uploaded.height ?? null,
    };
  } catch (err) {
    logger.error({ err, messageId }, "Cloudinary upload failed");
    return null;
  }
}
