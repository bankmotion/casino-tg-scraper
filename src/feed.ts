import { Api } from "grammy";
import { config } from "./config.js";
import { logger } from "./logger.js";

/**
 * Optional live feed publisher.
 *
 * When FEED_TELEGRAM_CHAT_ID is set in .env, every classified promo is also
 * sent as a formatted Telegram message to that chat. Useful for:
 *   - inspecting captures in real time during development
 *   - running a public "live feed" channel without a website yet
 *
 * The bot needs to be an admin of the target channel with "Post Messages"
 * rights. For a private DM stream, set the chat id to your own user id.
 *
 * If FEED_TELEGRAM_CHAT_ID is blank, publish() is a no-op — backend storage
 * still happens as normal.
 */

const api: Api | null = config.feed.chatId ? new Api(config.bot.token) : null;

export interface PromoPayload {
  channel_username: string | null;
  channel_title: string;
  partner_id: string;
  text: string | null;
  classification: {
    timestamp: string;
    confidence: number;
    code: string | null;
    summary: string | null;
    value_usd: number | null;
    wager_req_usd: number | null;
    claims_count: number | null;
  };
}

function escapeMd(s: string): string {
  return s.replace(/([_*`\[\]])/g, "\\$1");
}

function fmtUsd(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1000) return `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return `$${n}`;
}

function format(p: PromoPayload): string {
  const c = p.classification;
  const channel = p.channel_username
    ? `@${escapeMd(p.channel_username)}`
    : escapeMd(p.channel_title);
  const valuePer1k =
    c.value_usd != null && c.wager_req_usd && c.wager_req_usd > 0
      ? `$${(c.value_usd / (c.wager_req_usd / 1000)).toFixed(2)}`
      : null;

  const lines: string[] = [];
  lines.push(`🎰 *${escapeMd(p.partner_id)}* — ${channel}`);
  lines.push("");
  if (c.code) lines.push(`🔑 Code: \`${c.code}\``);
  if (c.summary) lines.push(`📋 ${escapeMd(c.summary)}`);
  lines.push("");
  const stats: string[] = [];
  if (c.value_usd != null) stats.push(`💵 ${fmtUsd(c.value_usd)}`);
  if (c.wager_req_usd != null) stats.push(`🎯 wager ${fmtUsd(c.wager_req_usd)}`);
  if (valuePer1k) stats.push(`📊 ${valuePer1k}/1K`);
  if (c.claims_count != null) stats.push(`🔥 ${c.claims_count} claims`);
  if (stats.length) lines.push(stats.join("  •  "));
  lines.push("");
  lines.push(`_confidence ${(c.confidence * 100).toFixed(0)}%_`);

  return lines.join("\n");
}

export async function publish(payload: PromoPayload): Promise<void> {
  if (!api || !config.feed.chatId) return;
  try {
    await api.sendMessage(config.feed.chatId, format(payload), {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    logger.warn({ err }, "Feed publish failed (non-fatal)");
  }
}
