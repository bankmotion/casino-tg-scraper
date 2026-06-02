import { logger } from "./logger.js";
import { createClient } from "./listener/client.js";
import { ChannelManager } from "./listener/channels.js";
import { buildHandler } from "./listener/handler.js";
import { Queue } from "./backend/queue.js";
import { startFlusher } from "./backend/client.js";
import { startAdminBot } from "./admin-bot/bot.js";

process.on("unhandledRejection", (reason: unknown) => {
  logger.error({ reason }, "Unhandled rejection");
});

process.on("uncaughtException", (err: Error) => {
  logger.fatal({ err }, "Uncaught exception — exiting");
  process.exit(1);
});

async function main() {
  logger.info("Starting promo-listener…");

  const queue = new Queue();
  await queue.init();
  logger.info({ pending: await queue.size() }, "Queue initialised");

  const client = await createClient();

  startFlusher(queue);
  await startAdminBot(queue);

  const onMessage = buildHandler(client, queue);
  const manager = new ChannelManager(client, onMessage);
  await manager.start();

  logger.info("Listener up. Watching for new messages…");
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal error during startup — exiting");
  process.exit(1);
});
