import { Api, TelegramClient } from "telegram";
import { NewMessage, NewMessageEvent } from "telegram/events/index.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { fetchChannels, ChannelDef } from "../backend/client.js";

export interface ChannelEntity {
  def: ChannelDef;
  telegramId: string; // string repr of bigint
}

type OnMessage = (entity: ChannelEntity, event: NewMessageEvent) => Promise<void>;

export class ChannelManager {
  private client: TelegramClient;
  private current = new Map<number, ChannelEntity>(); // backend id -> entity
  private byTelegramId = new Map<string, ChannelEntity>(); // tg id -> entity
  private onMessage: OnMessage;

  constructor(client: TelegramClient, onMessage: OnMessage) {
    this.client = client;
    this.onMessage = onMessage;
  }

  async start(): Promise<void> {
    this.registerGlobalHandler();
    await this.sync();
    setInterval(() => {
      this.sync().catch((err) => logger.error({ err }, "Channel sync failed"));
    }, config.channels.pollIntervalMs);
  }

  private registerGlobalHandler(): void {
    this.client.addEventHandler(async (event: NewMessageEvent) => {
      const peer = event.message.peerId;
      if (!(peer instanceof Api.PeerChannel)) return;
      const tgId = peer.channelId.toString();
      const entity = this.byTelegramId.get(tgId);
      if (!entity) return;
      try {
        await this.onMessage(entity, event);
      } catch (err) {
        logger.error({ err, tgId }, "onMessage handler threw");
      }
    }, new NewMessage({}));
  }

  private async sync(): Promise<void> {
    let defs: ChannelDef[];
    try {
      defs = await fetchChannels();
    } catch (err) {
      logger.error({ err }, "fetchChannels failed");
      return;
    }

    const incomingIds = new Set(defs.map((d) => d.id));

    for (const [id, entity] of this.current.entries()) {
      if (!incomingIds.has(id)) {
        this.byTelegramId.delete(entity.telegramId);
        this.current.delete(id);
        logger.info({ id, username: entity.def.username }, "Channel removed from watchlist");
      }
    }

    for (const def of defs) {
      if (this.current.has(def.id)) continue;
      const tgId = await this.resolveAndJoin(def);
      if (tgId) {
        const entity: ChannelEntity = { def, telegramId: tgId };
        this.current.set(def.id, entity);
        this.byTelegramId.set(tgId, entity);
        logger.info({ id: def.id, username: def.username, tgId }, "Channel added to watchlist");
      }
    }
  }

  private async resolveAndJoin(def: ChannelDef): Promise<string | null> {
    try {
      if (def.username) {
        const handle = def.username.replace(/^@/, "");
        const entity: any = await this.client.getEntity(handle);
        try {
          await this.client.invoke(
            new Api.channels.JoinChannel({ channel: entity })
          );
        } catch (err: any) {
          const msg = String(err?.message || "");
          if (!msg.includes("ALREADY") && !msg.includes("USER_ALREADY_PARTICIPANT")) {
            logger.warn({ err: msg, username: def.username }, "JoinChannel warning");
          }
        }
        return entity.id.toString();
      }

      if (def.invite_link) {
        const m = def.invite_link.match(/(?:t\.me\/\+|joinchat\/)([\w-]+)/);
        if (!m) {
          logger.warn({ link: def.invite_link }, "Unrecognized invite link format");
          return null;
        }
        try {
          const result: any = await this.client.invoke(
            new Api.messages.ImportChatInvite({ hash: m[1] })
          );
          const chat = result.chats?.[0];
          return chat?.id?.toString() ?? null;
        } catch (err: any) {
          const msg = String(err?.message || "");
          if (msg.includes("USER_ALREADY_PARTICIPANT")) {
            const entity: any = await this.client.getEntity(def.invite_link);
            return entity.id.toString();
          }
          throw err;
        }
      }

      logger.warn({ def }, "Channel has neither username nor invite_link");
      return null;
    } catch (err) {
      logger.error({ err, def }, "Failed to resolve/join channel");
      return null;
    }
  }
}
