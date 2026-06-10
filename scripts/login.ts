import "dotenv/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
// @ts-expect-error -- "input" ships without TS types but works fine at runtime
import input from "input";

async function main() {
  const apiId = Number(process.env.TG_API_ID);
  const apiHash = process.env.TG_API_HASH;
  if (!apiId || !apiHash) {
    console.error("Set TG_API_ID and TG_API_HASH in .env first.");
    process.exit(1);
  }

  const session = new StringSession("");
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  console.log(
    "\nA login code will be sent to your Telegram account. Have it ready.\n"
  );

  await client.start({
    phoneNumber: async () => await input.text("Phone number (with country code): "),
    password: async () =>
      await input.text("2FA password (press Enter if none): "),
    phoneCode: async () =>
      await input.text("Code from Telegram: "),
    onError: (err) => console.error(err),
  });

  console.log("\n=== Login successful ===");
  console.log("Copy the line below into your .env file:\n");
  console.log(`TG_SESSION_STRING=${client.session.save()}\n`);

  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
