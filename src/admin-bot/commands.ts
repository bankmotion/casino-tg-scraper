import type { Bot, Context } from "grammy";
import { logger } from "../logger.js";
import { stats } from "../stats.js";
import { Queue } from "../backend/queue.js";
import {
  listAllChannels,
  createChannel,
  updateChannel,
  deleteChannel,
} from "../backend/admin.js";
import type { ChannelPatch } from "../backend/types.js";

const HELP = `*Promo-listener admin commands*

\`/list\` — show all channels with their IDs
\`/add <username|invite_link> <partner_id> <title>\` — add a new channel
\`/edit <id> <field> <value>\` — edit (fields: \`target\`, \`username\`, \`invite_link\`, \`partner_id\`, \`title\`, \`is_active\`)
\`/delete <id>\` — soft-delete (deactivate) a channel
\`/delete <id> hard\` — hard-delete a channel
\`/status\` — queue + activity health check
\`/help\` — this message`;

export function registerCommands(bot: Bot, queue: Queue): void {
  bot.command(["start", "help"], async (ctx) => {
    await ctx.reply(HELP, { parse_mode: "Markdown" });
  });

  bot.command("list", async (ctx) => handleList(ctx));
  bot.command("add", async (ctx) => handleAdd(ctx));
  bot.command("edit", async (ctx) => handleEdit(ctx));
  bot.command("delete", async (ctx) => handleDelete(ctx));
  bot.command("status", async (ctx) => handleStatus(ctx, queue));
}

// ---------- /list ----------
async function handleList(ctx: Context): Promise<void> {
  try {
    const channels = await listAllChannels();
    if (channels.length === 0) {
      await ctx.reply("No channels configured.");
      return;
    }
    const lines = channels.map((c) => {
      const target = c.username ? `@${c.username}` : c.invite_link || "(none)";
      const flag = c.is_active ? "✅" : "⏸";
      return (
        `${flag} *${c.id}* — ${escapeMd(c.title)}\n` +
        `   partner: \`${c.partner_id}\`  •  ${escapeMd(target)}`
      );
    });
    await ctx.reply(lines.join("\n\n"), { parse_mode: "Markdown" });
  } catch (err) {
    await replyError(ctx, "list", err);
  }
}

// ---------- /add ----------
async function handleAdd(ctx: Context): Promise<void> {
  const args = parseArgs(ctx.message?.text);
  if (args.length < 3) {
    await ctx.reply(
      "Usage: `/add <username|invite_link> <partner_id> <title>`\n" +
        "Example: `/add @casino_promos 42 Casino Promos`",
      { parse_mode: "Markdown" }
    );
    return;
  }
  const target = args[0];
  const partnerId = args[1].trim();
  const title = args.slice(2).join(" ");

  if (!partnerId) {
    await ctx.reply(
      "Invalid `partner_id` — must be the casino's partner id from the backend.",
      { parse_mode: "Markdown" }
    );
    return;
  }

  const input = { ...parseChannelTarget(target), partner_id: partnerId, title };
  if (!input.username && !input.invite_link) {
    await ctx.reply(
      "Couldn't parse the channel target. Use `@handle`, `handle`, `https://t.me/handle`, or a `https://t.me/+abc...` invite link.",
      { parse_mode: "Markdown" }
    );
    return;
  }

  try {
    const created = await createChannel(input);
    await ctx.reply(
      `Added: *${created.id}* — ${escapeMd(created.title)} (partner \`${created.partner_id}\`)\n` +
        `Listener will pick it up on next sync (≤ 3 min).`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    await replyError(ctx, "add", err);
  }
}

// ---------- /edit ----------
async function handleEdit(ctx: Context): Promise<void> {
  const args = parseArgs(ctx.message?.text);
  if (args.length < 3) {
    await ctx.reply(
      "Usage: `/edit <id> <field> <value>`\nFields: `username`, `invite_link`, `partner_id`, `title`, `is_active`",
      { parse_mode: "Markdown" }
    );
    return;
  }
  const id = Number(args[0]);
  const field = args[1].toLowerCase();
  const value = args.slice(2).join(" ");

  if (!Number.isFinite(id)) {
    await ctx.reply("Invalid id.");
    return;
  }

  const patch: ChannelPatch = {};
  switch (field) {
    case "target":
    case "username":
    case "invite_link": {
      // Clear: /edit <id> username null   (or empty)
      if (!value || value.toLowerCase() === "null") {
        patch[field === "target" ? "username" : (field as "username" | "invite_link")] = null;
        break;
      }
      // Smart-parse regardless of which field name was used.
      const parsed = parseChannelTarget(value);
      if (parsed.username) {
        patch.username = parsed.username;
        patch.invite_link = null;
      } else if (parsed.invite_link) {
        patch.invite_link = parsed.invite_link;
        patch.username = null;
      } else {
        await ctx.reply("Couldn't parse the value.");
        return;
      }
      break;
    }
    case "partner_id": {
      const pid = value.trim();
      if (!pid) {
        await ctx.reply("`partner_id` must not be empty.", {
          parse_mode: "Markdown",
        });
        return;
      }
      patch.partner_id = pid;
      break;
    }
    case "title":
      patch.title = value;
      break;
    case "is_active":
      patch.is_active = /^(true|1|yes|on)$/i.test(value);
      break;
    default:
      await ctx.reply(
        "Unknown field. Use one of: `target` (smart), `username`, `invite_link`, `partner_id`, `title`, `is_active`.",
        { parse_mode: "Markdown" }
      );
      return;
  }

  try {
    const updated = await updateChannel(id, patch);
    await ctx.reply(
      `Updated *${updated.id}* — ${escapeMd(updated.title)} (partner \`${updated.partner_id}\`).`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    await replyError(ctx, "edit", err);
  }
}

// ---------- /delete ----------
async function handleDelete(ctx: Context): Promise<void> {
  const args = parseArgs(ctx.message?.text);
  if (args.length < 1) {
    await ctx.reply("Usage: `/delete <id> [hard]`", { parse_mode: "Markdown" });
    return;
  }
  const id = Number(args[0]);
  const hard = args[1]?.toLowerCase() === "hard";
  if (!Number.isFinite(id)) {
    await ctx.reply("Invalid id.");
    return;
  }
  try {
    await deleteChannel(id, hard);
    await ctx.reply(`${hard ? "Hard-deleted" : "Deactivated"} channel *${id}*.`, {
      parse_mode: "Markdown",
    });
  } catch (err) {
    await replyError(ctx, "delete", err);
  }
}

// ---------- /status ----------
async function handleStatus(ctx: Context, queue: Queue): Promise<void> {
  try {
    const [pending, channels] = await Promise.all([
      queue.size(),
      listAllChannels().catch(() => null),
    ]);
    const snap = stats.snapshot();
    const active = channels?.filter((c) => c.is_active).length ?? "?";
    const total = channels?.length ?? "?";
    const lastPromo = snap.lastPromoAt
      ? `${ago(snap.lastPromoAt)} ago (${snap.lastPromoChannel})`
      : "none since boot";

    const body =
      `*Status*\n` +
      `Booted: ${ago(snap.bootedAt)} ago\n` +
      `Channels: ${active} active / ${total} total\n` +
      `Queue: ${pending} pending POST${pending === 1 ? "" : "s"}\n` +
      `Last promo: ${lastPromo}\n` +
      `OpenAI calls today (UTC): ${snap.openAiCallsToday}`;

    await ctx.reply(body, { parse_mode: "Markdown" });
  } catch (err) {
    await replyError(ctx, "status", err);
  }
}

// ---------- helpers ----------

/**
 * Resolve any of the forms users naturally type into either a public
 * username or a private invite link:
 *
 *   "@winna"                            -> { username: "winna" }
 *   "winna"                             -> { username: "winna" }
 *   "t.me/winna"                        -> { username: "winna" }
 *   "https://t.me/winna"                -> { username: "winna" }
 *   "https://t.me/winna/8721"           -> { username: "winna" }  (message link)
 *   "https://t.me/+abc123xyz"           -> { invite_link: "https://t.me/+abc123xyz" }
 *   "https://t.me/joinchat/abc123"      -> { invite_link: ... }
 */
function parseChannelTarget(raw: string): { username?: string; invite_link?: string } {
  const s = raw.trim();
  if (/t\.me\/(?:\+|joinchat\/)/i.test(s)) {
    return { invite_link: s.startsWith("http") ? s : `https://${s}` };
  }
  const m = s.match(/(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]+)/i);
  if (m) return { username: m[1] };
  return { username: s.replace(/^@/, "") };
}

function parseArgs(text: string | undefined): string[] {
  if (!text) return [];
  const parts = text.trim().split(/\s+/);
  return parts.slice(1); // drop the command itself
}

function escapeMd(s: string): string {
  return s.replace(/([_*`\[\]])/g, "\\$1");
}

function ago(d: Date): string {
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

async function replyError(ctx: Context, op: string, err: unknown): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error({ err, op }, "Admin bot command failed");
  await ctx.reply(`❌ ${op} failed: ${msg}`);
}