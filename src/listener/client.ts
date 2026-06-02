import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

export async function createClient(): Promise<TelegramClient> {
  const session = new StringSession(config.telegram.sessionString);
  const client = new TelegramClient(
    session,
    config.telegram.apiId,
    config.telegram.apiHash,
    {
      connectionRetries: 5,
      autoReconnect: true,
      retryDelay: 2000,
    }
  );

  await client.connect();

  if (!(await client.isUserAuthorized())) {
    throw new Error(
      "Telegram session is not authorized. Run `npm run login` to generate a valid TG_SESSION_STRING."
    );
  }

  const me: any = await client.getMe();
  logger.info(
    { username: me.username, id: me.id?.toString() },
    "Telegram client connected"
  );

  return client;
}
