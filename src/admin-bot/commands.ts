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
\`/add <username|invite_link> <title>\` — add a new channel
\`/edit <id> <field> <value>\` — edit (fields: \`username\`, \`invite_link\`, \`title\`, \`is_active\`)
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
      return `${flag} *${c.id}* — ${escapeMd(c.title)} (${escapeMd(target)})`;
    });
    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  } catch (err) {
    await replyError(ctx, "list", err);
  }
}

// ---------- /add ----------
async function handleAdd(ctx: Context): Promise<void> {
  const args = parseArgs(ctx.message?.text);
  if (args.length < 2) {
    await ctx.reply("Usage: `/add <username|invite_link> <title>`", {
      parse_mode: "Markdown",
    });
    return;
  }
  const target = args[0];
  const title = args.slice(1).join(" ");

  const isInvite = /^https?:\/\//i.test(target) || target.includes("t.me/");
  const input = isInvite
    ? { invite_link: target, title }
    : { username: target.replace(/^@/, ""), title };

  try {
    const created = await createChannel(input);
    await ctx.reply(
      `Added: *${created.id}* — ${escapeMd(created.title)}\n` +
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
      "Usage: `/edit <id> <field> <value>`\nFields: `username`, `invite_link`, `title`, `is_active`",
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
    case "username":
      patch.username = value.replace(/^@/, "") || null;
      break;
    case "invite_link":
      patch.invite_link = value || null;
      break;
    case "title":
      patch.title = value;
      break;
    case "is_active":
      patch.is_active = /^(true|1|yes|on)$/i.test(value);
      break;
    default:
      await ctx.reply(
        "Unknown field. Use one of: `username`, `invite_link`, `title`, `is_active`.",
        { parse_mode: "Markdown" }
      );
      return;
  }

  try {
    const updated = await updateChannel(id, patch);
    await ctx.reply(`Updated *${updated.id}* — ${escapeMd(updated.title)}.`, {
      parse_mode: "Markdown",
    });
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
      ? `${ago(snap.lastPromoAt)} (${snap.lastPromoChannel})`
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
