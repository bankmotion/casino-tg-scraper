import { Bot } from "grammy";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { Queue } from "../backend/queue.js";
import { adminOnly } from "./auth.js";
import { registerCommands } from "./commands.js";

/**
 * Initialise and start the admin Telegram Bot.
 * Bot API token comes from BotFather (BOT_TOKEN).
 * Admins are whitelisted by Telegram user ID (ADMIN_TELEGRAM_IDS).
 */
export async function startAdminBot(queue: Queue): Promise<void> {
  if (config.bot.adminIds.length === 0) {
    logger.warn(
      "ADMIN_TELEGRAM_IDS is empty — admin bot will accept nothing. Add your Telegram user ID to use commands."
    );
  }

  const bot = new Bot(config.bot.token);

  bot.use(adminOnly);
  registerCommands(bot, queue);

  bot.catch((err) => {
    logger.error({ err: err.error }, "Admin bot handler threw");
  });

  // Long-polling runs forever; don't await.
  bot
    .start({
      onStart: (info) => {
        logger.info(
          { username: info.username, admins: config.bot.adminIds.length },
          "Admin bot started"
        );
      },
    })
    .catch((err) => {
      logger.fatal({ err }, "Admin bot crashed — exiting");
      process.exit(1);
    });
}
