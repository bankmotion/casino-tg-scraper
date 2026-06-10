import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import nodePath from "node:path";

/**
 * Mock of the real backend API the listener will eventually POST to.
 *
 * - Hardcodes the Winna channel so the listener has something to watch.
 * - Accepts the same X-API-Key the real backend will require.
 * - Logs every incoming POST /api/messages and persists them to
 *   ./data/mock-received.jsonl for later inspection.
 * - Implements the 4 admin CRUD endpoints so the Telegram admin bot
 *   commands also work end-to-end while waiting on the real backend.
 *
 * Run with:  npm run mock
 */

const PORT = Number(process.env.MOCK_PORT || 3000);
const API_KEY = process.env.BACKEND_API_KEY || "test-key";
const RECEIVED_FILE = "./data/mock-received.jsonl";

interface Channel {
  id: number;
  partner_id: string;
  username: string | null;
  invite_link: string | null;
  title: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

let nextChannelId = 2;
const now = () => new Date().toISOString();

const channels: Channel[] = [
  {
    id: 1,
    partner_id: "winna",
    username: "Winna",
    invite_link: null,
    title: "Winna",
    is_active: true,
    created_at: now(),
    updated_at: now(),
  },
];

async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : null;
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  res.statusCode = status;
  if (body === undefined) {
    res.end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}

function logHit(method: string, urlPath: string, extra = ""): void {
  console.log(`[${ts()}] ${method} ${urlPath} ${extra}`);
}

async function persistMessage(payload: any): Promise<boolean> {
  const key = `${payload.channel_id}:${payload.message_id}`;
  let existing = "";
  try {
    existing = await fs.readFile(RECEIVED_FILE, "utf8");
  } catch {
    /* file may not exist yet */
  }
  if (existing.includes(`"_key":"${key}"`)) return false;

  await fs.mkdir(nodePath.dirname(RECEIVED_FILE), { recursive: true });
  const line = JSON.stringify({ _key: key, _at: now(), ...payload }) + "\n";
  await fs.appendFile(RECEIVED_FILE, line, "utf8");
  return true;
}

const server = createServer(async (req, res) => {
  try {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== API_KEY) {
      logHit(req.method || "?", req.url || "?", "→ 401 bad key");
      return send(res, 401, { error: "Unauthorized" });
    }

    const url = new URL(req.url || "/", `http://localhost:${PORT}`);
    const method = req.method || "GET";
    const p = url.pathname;

    // -------- listener-facing --------
    if (method === "GET" && p === "/api/channels") {
      const activeOnly = url.searchParams.get("active_only") !== "false";
      const list = activeOnly ? channels.filter((c) => c.is_active) : channels;
      logHit("GET", p, `→ 200 (${list.length} channel${list.length === 1 ? "" : "s"})`);
      return send(res, 200, list);
    }

    if (method === "POST" && p === "/api/messages") {
      const body = await readJsonBody(req);
      const stored = await persistMessage(body);
      const c = body.classification || {};
      console.log("");
      console.log(`[${ts()}] POST /api/messages — ${stored ? "stored" : "duplicate"}`);
      console.log(`  channel:    ${body.channel_username || body.channel_id} (partner=${body.partner_id})`);
      console.log(`  code:       ${c.code ?? "-"}`);
      console.log(`  summary:    ${c.summary ?? "-"}`);
      console.log(`  value_usd:  ${c.value_usd ?? "-"}    wager_req: ${c.wager_req_usd ?? "-"}`);
      console.log(`  confidence: ${c.confidence ?? "-"}`);
      console.log("");
      return send(
        res,
        stored ? 201 : 200,
        { id: Math.floor(Math.random() * 100000), status: stored ? "stored" : "duplicate" }
      );
    }

    // -------- admin --------
    if (method === "GET" && p === "/api/admin/channels") {
      logHit("GET", p, `→ 200 (${channels.length})`);
      return send(res, 200, channels);
    }

    if (method === "POST" && p === "/api/admin/channels") {
      const body = await readJsonBody(req);
      if (!body?.title || !body?.partner_id) {
        return send(res, 400, { error: "title and partner_id are required" });
      }
      if (!body.username && !body.invite_link) {
        return send(res, 400, { error: "username or invite_link is required" });
      }
      const ch: Channel = {
        id: nextChannelId++,
        partner_id: body.partner_id,
        username: body.username ?? null,
        invite_link: body.invite_link ?? null,
        title: body.title,
        is_active: body.is_active ?? true,
        created_at: now(),
        updated_at: now(),
      };
      channels.push(ch);
      logHit("POST", p, `→ 201 (id=${ch.id} ${ch.username || ch.invite_link})`);
      return send(res, 201, ch);
    }

    const idMatch = p.match(/^\/api\/admin\/channels\/(\d+)$/);
    if (idMatch && (method === "PATCH" || method === "DELETE")) {
      const id = Number(idMatch[1]);
      const idx = channels.findIndex((c) => c.id === id);
      if (idx === -1) {
        logHit(method, p, "→ 404");
        return send(res, 404, { error: "Not found" });
      }

      if (method === "PATCH") {
        const body = await readJsonBody(req);
        const updated: Channel = {
          ...channels[idx],
          ...body,
          updated_at: now(),
        };
        channels[idx] = updated;
        logHit("PATCH", p, "→ 200");
        return send(res, 200, updated);
      }

      // DELETE
      const hard = url.searchParams.get("hard") === "true";
      if (hard) {
        channels.splice(idx, 1);
        logHit("DELETE", p, "→ 204 (hard)");
      } else {
        channels[idx].is_active = false;
        channels[idx].updated_at = now();
        logHit("DELETE", p, "→ 204 (soft)");
      }
      return send(res, 204);
    }

    logHit(method, p, "→ 404");
    send(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(`[${ts()}] handler error:`, err);
    send(res, 500, { error: "Internal error" });
  }
});

server.listen(PORT, () => {
  console.log("");
  console.log("  ┌─────────────────────────────────────────────────────────┐");
  console.log(`  │  mock-backend listening on http://localhost:${PORT}        │`);
  console.log(`  │  X-API-Key required: ${API_KEY.padEnd(35)}│`);
  console.log(`  │  Seeded channels:    ${String(channels.length).padEnd(35)}│`);
  console.log(`  │  Messages stored at: ${RECEIVED_FILE.padEnd(35)}│`);
  console.log("  └─────────────────────────────────────────────────────────┘");
  console.log("");
  console.log("Seeded channel:");
  for (const c of channels) {
    console.log(`  - id=${c.id}  partner=${c.partner_id}  @${c.username}  "${c.title}"`);
  }
  console.log("");
});
