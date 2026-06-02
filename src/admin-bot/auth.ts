import type { Context, NextFunction } from "grammy";
import { config } from "../config.js";
import { logger } from "../logger.js";

const ADMINS = new Set(config.bot.adminIds);

/**
 * grammy middleware: silently drops messages from non-admin users.
 * Admin identity = Telegram user ID, whitelisted via ADMIN_TELEGRAM_IDS env var.
 */
export async function adminOnly(ctx: Context, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId || !ADMINS.has(userId)) {
    logger.warn(
      { userId, username: ctx.from?.username },
      "Bot command from non-admin — ignored"
    );
    return;
  }
  await next();
}
