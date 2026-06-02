# promo-listener

24/7 Telegram service with two halves:

- **Listener** — watches casino channels via MTProto, classifies promo messages with OpenAI, uploads media to Cloudinary, pushes results to the backend API.
- **Admin bot** — a Telegram Bot API bot for `/add`, `/list`, `/edit`, `/delete`, `/status` commands. Only whitelisted Telegram user IDs can use it.

Both halves run inside the same Node process.

## Architecture

```
   ┌──────────────────────────────────┐   GET  /api/channels    ┌─────────────────┐
   │       promo-listener (this)      │   POST /api/messages    │                 │
   │                                  │ ──────────────────────▶ │   Backend API   │
   │   ┌────────────┐  ┌────────────┐ │   /api/admin/channels   │   owns Postgres │
   │   │  Listener  │  │ Admin bot  │ │ ──────────────────────▶ │                 │
   │   │  (MTProto) │  │ (Bot API)  │ │                         │                 │
   │   └─────┬──────┘  └─────┬──────┘ │                         └─────────────────┘
   └─────────┼───────────────┼────────┘
             │ classify      │ /add /edit /delete
             ▼               ▲
       ┌──────────┐    ┌────────────┐
       │  OpenAI  │    │   Admin    │
       └──────────┘    │  (you)     │
       ┌──────────┐    └────────────┘
       │Cloudinary│
       └──────────┘
```

The listener never touches the backend's database. All state flows through the API contract in [API.md](./API.md).

## Pipeline (per new Telegram message)

1. **Pre-filter** ([src/listener/prefilter.ts](src/listener/prefilter.ts)) — cheap keyword / emoji / code-token / URL check. Drops obvious non-promos before any paid API call.
2. **OpenAI classify** ([src/listener/classifier.ts](src/listener/classifier.ts)) — `gpt-4o-mini` with JSON-schema structured output. Returns `{is_promo, confidence, code, summary}`.
3. **Cloudinary upload** ([src/listener/cloudinary.ts](src/listener/cloudinary.ts)) — only runs for confirmed promos that have media.
4. **Enqueue** ([src/backend/queue.ts](src/backend/queue.ts)) — payload written to `data/queue/` as a JSON file (durable on disk).
5. **Flush** ([src/backend/client.ts](src/backend/client.ts)) — background worker POSTs each file to the backend, deletes on success, retries with exponential backoff on failure.

Channel list is owned by the backend's `/api/channels` endpoint. The listener polls it every 3 min and joins/leaves accordingly.

## Admin bot commands

You DM the bot from any of the whitelisted accounts:

| Command | Purpose |
|---|---|
| `/list` | Show all channels with IDs |
| `/add <username\|invite_link> <partner_id> <title>` | Add a new channel (partner_id is the casino's partner id from the backend) |
| `/edit <id> <field> <value>` | Edit a channel (fields: `username`, `invite_link`, `partner_id`, `title`, `is_active`) |
| `/delete <id>` | Soft-delete (deactivate) a channel |
| `/delete <id> hard` | Hard-delete a channel |
| `/status` | Queue size, last promo, OpenAI calls today |
| `/help` | List commands |

New channels are picked up by the listener on the next sync (within ~3 min). No restart needed.

## Project layout

```
promo-listener/
├── src/
│   ├── index.ts                 # entrypoint — wires listener + bot + flusher
│   ├── config.ts                # env vars
│   ├── logger.ts                # pino
│   ├── stats.ts                 # in-memory counters for /status
│   │
│   ├── listener/                # MTProto pipeline (reading Telegram)
│   │   ├── client.ts            # GramJS connection
│   │   ├── channels.ts          # poll backend + join channels
│   │   ├── handler.ts           # NewMessage pipeline orchestrator
│   │   ├── prefilter.ts         # stage 1: keywords / codes / urls
│   │   ├── classifier.ts        # stage 2: OpenAI
│   │   └── cloudinary.ts        # stage 3: media upload
│   │
│   ├── admin-bot/               # Bot API (admin commands)
│   │   ├── bot.ts               # grammy setup
│   │   ├── auth.ts              # ADMIN_TELEGRAM_IDS whitelist middleware
│   │   └── commands.ts          # /add /list /edit /delete /status /help
│   │
│   └── backend/                 # HTTP client for backend API
│       ├── http.ts              # shared apiFetch (X-API-Key)
│       ├── client.ts            # listener: fetchChannels, postMessage, flusher
│       ├── admin.ts             # CRUD for /api/admin/channels
│       ├── queue.ts             # durable on-disk retry queue
│       └── types.ts             # ChannelDef / ChannelInput / ChannelPatch
│
├── scripts/login.ts             # one-shot StringSession generator
├── data/queue/                  # pending POSTs (gitignored)
├── .env.example
├── API.md                       # contract for backend developer
├── package.json
└── tsconfig.json
```

## Quickstart (local development)

### 1. Install dependencies

```
npm install
```

### 2. Get Telegram MTProto credentials (for the listener)

Go to https://my.telegram.org on a dedicated account. Copy `api_id` and `api_hash` into `.env`:

```
TG_API_ID=...
TG_API_HASH=...
```

Then generate a session string interactively:

```
npm run login
```

Paste the printed `TG_SESSION_STRING=...` line into `.env`.

### 3. Create the admin bot (for /add /edit /delete)

In Telegram, DM `@BotFather`:

1. `/newbot` → follow the prompts → it gives you a token like `123456:ABC-DEF...`
2. Paste into `.env` as `BOT_TOKEN`.

Find your own Telegram user ID via `@userinfobot` (just send `/start`). Add it to `.env`:

```
ADMIN_TELEGRAM_IDS=123456789
```

Add more IDs, comma-separated, for additional admins.

### 4. Fill in the rest of `.env`

```
OPENAI_API_KEY=...
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
BACKEND_BASE_URL=https://api.example.com
BACKEND_API_KEY=...
```

### 5. Run

Dev mode (auto-reloads):

```
npm run dev
```

Production:

```
npm run build
npm start
```

Use whatever supervisor you like to keep it alive 24/7 — `pm2`, `screen`, `tmux`, etc.

```
pm2 start dist/src/index.js --name promo-listener
pm2 logs promo-listener
```

## Configuration reference

All config is via env vars (see [.env.example](.env.example)).

| Var | Required | Purpose |
|---|---|---|
| `TG_API_ID` | yes | From my.telegram.org |
| `TG_API_HASH` | yes | From my.telegram.org |
| `TG_SESSION_STRING` | yes | Generated by `npm run login` |
| `OPENAI_API_KEY` | yes | OpenAI account key |
| `OPENAI_MODEL` | no | Default `gpt-4o-mini` |
| `CLOUDINARY_CLOUD_NAME` | yes | Cloudinary cloud |
| `CLOUDINARY_API_KEY` | yes | Cloudinary key |
| `CLOUDINARY_API_SECRET` | yes | Cloudinary secret |
| `CLOUDINARY_FOLDER` | no | Default `promo-listener` |
| `BACKEND_BASE_URL` | yes | e.g. `https://api.example.com` |
| `BACKEND_API_KEY` | yes | Shared secret for `X-API-Key` |
| `BOT_TOKEN` | yes | Admin bot token from @BotFather |
| `ADMIN_TELEGRAM_IDS` | yes | Comma-separated Telegram user IDs allowed to use admin commands |
| `QUEUE_DIR` | no | Default `./data/queue` |
| `CHANNELS_POLL_INTERVAL_MS` | no | Default `180000` (3 min) |
| `LOG_LEVEL` | no | Default `info` |

## Cost notes

- Pre-filter rejects most messages before any OpenAI call. Casino channels are noisy; this stage matters.
- OpenAI cost per surviving message at `gpt-4o-mini` rates is small but multiplies fast across many channels. Keep an eye on usage in the OpenAI dashboard.
- Cloudinary upload only fires for messages that pass the OpenAI step, so media bandwidth stays bounded by actual promo volume.

## API contract for backend dev

See [API.md](./API.md).
