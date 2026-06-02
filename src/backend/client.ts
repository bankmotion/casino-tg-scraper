import { logger } from "../logger.js";
import { apiFetch } from "./http.js";
import { Queue } from "./queue.js";
import type { ChannelDef } from "./types.js";

export type { ChannelDef } from "./types.js";

/**
 * Fetch the active channel watchlist from the backend.
 * Called by listener/channels.ts on the sync interval.
 */
export async function fetchChannels(): Promise<ChannelDef[]> {
  const res = await apiFetch("/api/channels?active_only=true");
  if (!res.ok) {
    throw new Error(`GET /api/channels failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as ChannelDef[];
}

/**
 * Push one classified promo to the backend.
 * Returns true if the listener should consider it delivered (success or 4xx
 * malformed — those will never succeed on retry).
 */
async function postMessage(payload: unknown): Promise<boolean> {
  let res: Response;
  try {
    res = await apiFetch("/api/messages", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (err) {
    logger.warn({ err }, "Backend POST network error — will retry");
    return false;
  }

  if (res.status === 400) {
    logger.error({ status: 400 }, "Backend rejected payload as malformed — dropping");
    return true;
  }
  if (res.status === 401) {
    logger.error("Backend returned 401 — check BACKEND_API_KEY. Pausing flusher.");
    return false;
  }
  if (!res.ok) {
    logger.warn({ status: res.status }, "Backend POST failed — will retry");
    return false;
  }
  return true;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Background loop: drains the on-disk queue by POSTing each file to the backend.
 * Survives backend outages via exponential backoff. Never terminates.
 */
export function startFlusher(queue: Queue): void {
  const BASE_DELAY = 1000;
  const MAX_DELAY = 60_000;
  let delay = BASE_DELAY;

  (async function loop() {
    while (true) {
      const files = await queue.list();
      if (files.length === 0) {
        delay = BASE_DELAY;
        await sleep(BASE_DELAY);
        continue;
      }

      let madeProgress = false;
      for (const f of files) {
        let payload: unknown;
        try {
          payload = await queue.read(f);
        } catch (err) {
          logger.error({ err, file: f }, "Corrupt queue entry — removing");
          await queue.remove(f).catch(() => {});
          continue;
        }

        const ok = await postMessage(payload);
        if (ok) {
          await queue.remove(f).catch(() => {});
          madeProgress = true;
        } else {
          break;
        }
      }

      if (madeProgress) {
        delay = BASE_DELAY;
      } else {
        delay = Math.min(delay * 2, MAX_DELAY);
        logger.debug({ delayMs: delay }, "Flusher backing off");
        await sleep(delay);
      }
    }
  })().catch((err) => {
    logger.fatal({ err }, "Flusher loop crashed");
    process.exit(1);
  });
}
