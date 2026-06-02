import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const config = {
  telegram: {
    apiId: Number(required("TG_API_ID")),
    apiHash: required("TG_API_HASH"),
    sessionString: required("TG_SESSION_STRING"),
  },
  openai: {
    apiKey: required("OPENAI_API_KEY"),
    model: optional("OPENAI_MODEL", "gpt-4o-mini"),
  },
  cloudinary: {
    cloudName: required("CLOUDINARY_CLOUD_NAME"),
    apiKey: required("CLOUDINARY_API_KEY"),
    apiSecret: required("CLOUDINARY_API_SECRET"),
    folder: optional("CLOUDINARY_FOLDER", "promo-listener"),
  },
  backend: {
    baseUrl: required("BACKEND_BASE_URL").replace(/\/$/, ""),
    apiKey: required("BACKEND_API_KEY"),
  },
  bot: {
    token: required("BOT_TOKEN"),
    adminIds: required("ADMIN_TELEGRAM_IDS")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
  },
  queue: {
    dir: optional("QUEUE_DIR", "./data/queue"),
  },
  channels: {
    pollIntervalMs: Number(optional("CHANNELS_POLL_INTERVAL_MS", "180000")),
  },
  logLevel: optional("LOG_LEVEL", "info"),
};
