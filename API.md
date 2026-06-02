# Backend API Contract — promo-listener

This is the surface area the `promo-listener` service expects from the backend.

- **2 listener-facing endpoints** — called by the MTProto pipeline
- **4 admin endpoints** — called by the in-process Telegram admin bot when an admin runs `/add`, `/list`, `/edit`, `/delete`

All 6 endpoints are called by the same service (`promo-listener`) and use the same auth: a single shared API key.

---

## Auth

| Endpoint group | Header |
|---|---|
| Everything (`/api/*`) | `X-API-Key: <shared-secret>` |

The key value is configured in the listener's `.env` as `BACKEND_API_KEY`. There is **no login flow** — admin identity is enforced by the Telegram bot (whitelisted user IDs), not at the HTTP layer.

### ID types

- `channel_id` is sent **as a string** in all listener payloads (Telegram channel IDs can exceed JavaScript's safe integer range). Backend should cast to `BIGINT` at the DB layer.
- `message_id` is a normal integer (always within int32 range in practice).

---

# Listener-facing endpoints

## 1. `GET /api/channels`

Listener polls this every ~3 min to know which channels to watch.

### Query params

| Name | Type | Required | Description |
|---|---|---|---|
| `active_only` | bool | no | If `true`, return only `is_active=true` channels. Defaults to `true`. |

### Request

```
GET /api/channels?active_only=true
X-API-Key: sk_live_xxxxx
```

### Response — `200 OK`

```json
[
  {
    "id": 1,
    "partner_id": "stake",
    "username": "casino_promos",
    "invite_link": null,
    "title": "Casino Promos",
    "is_active": true
  },
  {
    "id": 2,
    "partner_id": "shuffle",
    "username": null,
    "invite_link": "https://t.me/+abc123xyz",
    "title": "VIP Bonuses",
    "is_active": true
  }
]
```

Either `username` or `invite_link` must be non-null. If both are set, `username` wins.

`partner_id` identifies which casino partner this channel represents (a key from the backend's `partners` / `casinos` table). The listener forwards it on every `POST /api/messages` so the backend can attribute the promo to the right casino without a lookup.

### Errors

- `401` — missing / invalid API key
- `5xx` — listener retries with exponential backoff

---

## 2. `POST /api/messages`

Listener pushes one classified promo per call, after the pre-filter and OpenAI classification have both passed.

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `channel_id` | string | yes | Telegram channel ID as a string (int64) |
| `channel_username` | string \| null | yes | `@handle` without the `@`, or `null` for private channels |
| `channel_title` | string | yes | Display name from the channel info row |
| `message_id` | int | yes | Telegram message ID; together with `channel_id` it is the idempotency key |
| `text` | string \| null | yes | Message text; `null` for media-only messages (which still pass through if pre-filter and classifier find promo cues in the text — but text-only is the normal case) |
| `classification` | object | yes | See below |
| `raw` | object | yes | Full GramJS message object (bigints serialized as strings) |

### `classification` object

Result of the OpenAI classification + extraction step. All fields are always present; `null` means the model could not extract that field from the message text.

The listener only POSTs messages where `confidence >= 0.5`, so the backend will never see low-confidence (non-promo) records.

| Field | Type | Source | Description |
|---|---|---|---|
| `partner_id` | string | channel row | Casino partner id copied from the channel definition. OpenAI does **not** extract this. |
| `timestamp` | string (ISO-8601) | Telegram | When the message was posted to Telegram (UTC). This is the canonical "promo dropped at" time the website should display. |
| `confidence` | number | OpenAI | 0..1 certainty that this is a promo. Backend can use it to rank or threshold further. |
| `code` | string \| null | OpenAI | Promo code, verbatim with case + punctuation preserved. |
| `summary` | string \| null | OpenAI | Short one-line description of the offer. |
| `value_usd` | number \| null | OpenAI | USD value of the bonus (e.g. `5` from "$5 value"). Null if not USD or not stated. |
| `wager_req_usd` | number \| null | OpenAI | USD wagering requirement (e.g. `15000` from "$15,000 wager required"). Null if not USD or not stated. |
| `claims_count` | int \| null | OpenAI | Number of claims/redemptions stated in the message (casino-reported, not your-site analytics). |

```json
{
  "partner_id": "winna",
  "timestamp": "2026-06-01T12:34:56Z",
  "confidence": 0.96,
  "code": "BL_CKJ_CK-05-m8k2",
  "summary": "Winna Blackjack bonus code, $5 value",
  "value_usd": 5,
  "wager_req_usd": 15000,
  "claims_count": 200
}
```

### Request example

```
POST /api/messages
X-API-Key: sk_live_xxxxx
Content-Type: application/json
```

```json
{
  "channel_id": "1402934877",
  "channel_username": "casino_promos",
  "channel_title": "Casino Promos",
  "message_id": 8721,
  "text": "🎁 Use code WELCOME200 for a 200% bonus on your first deposit!",
  "classification": {
    "partner_id": "stake",
    "timestamp": "2026-06-01T12:34:56Z",
    "confidence": 0.94,
    "code": "WELCOME200",
    "summary": "200% deposit bonus, code WELCOME200",
    "value_usd": 25,
    "wager_req_usd": 75000,
    "claims_count": null
  },
  "raw": { "...": "full message object" }
}
```

### Responses

| Status | Body | Meaning |
|---|---|---|
| `201 Created` | `{ "id": 5821, "status": "stored" }` | New row inserted |
| `200 OK` | `{ "id": 5821, "status": "duplicate" }` | Idempotent: `(channel_id, message_id)` already existed; listener treats as success |

### Errors

| Status | Listener behavior |
|---|---|
| `400` | Listener logs and drops the payload (does **not** retry — payload is malformed) |
| `401` | Listener pauses flushing and alerts via logs (bad API key) |
| `5xx`, network error | Listener retries with exponential backoff (1 s → 60 s max) from its on-disk queue |

**Idempotency requirement**: backend must treat `(channel_id, message_id)` as a unique key and silently absorb duplicates. The listener may legitimately re-POST the same payload after a network blip.

---

# Admin endpoints

Called by the in-process Telegram admin bot. Same `X-API-Key` auth as the listener endpoints — no separate login or bearer token.

## 3. `GET /api/admin/channels`

List **all** channels (including inactive). Used by the bot's `/list` command.

### Query params

| Name | Type | Description |
|---|---|---|
| `q` | string | Optional search by `username` or `title` |
| `is_active` | bool | Optional filter by active state |

### Request

```
GET /api/admin/channels
X-API-Key: sk_live_xxxxx
```

### Response — `200 OK`

```json
[
  {
    "id": 1,
    "partner_id": "stake",
    "username": "casino_promos",
    "invite_link": null,
    "title": "Casino Promos",
    "is_active": true,
    "created_at": "2026-05-20T09:00:00Z",
    "updated_at": "2026-05-28T14:22:11Z"
  }
]
```

---

## 4. `POST /api/admin/channels`

Add a new channel. Used by the bot's `/add` command.

### Body

| Field | Type | Required | Description |
|---|---|---|---|
| `partner_id` | string | yes | Casino partner id (from backend's partners/casinos table) |
| `username` | string \| null | one of these two | `@handle` for public channels (without `@`) |
| `invite_link` | string \| null | one of these two | `https://t.me/+...` for private channels |
| `title` | string | yes | Display name |
| `is_active` | bool | no | Defaults to `true` |

### Request

```
POST /api/admin/channels
X-API-Key: sk_live_xxxxx
Content-Type: application/json
```

```json
{
  "partner_id": "stake",
  "username": "new_casino_channel",
  "invite_link": null,
  "title": "New Casino Channel",
  "is_active": true
}
```

### Response — `201 Created`

Full channel object (same shape as `GET /api/admin/channels[]`).

### Errors

- `400` — validation (neither `username` nor `invite_link` provided)
- `409` — duplicate channel (same `username` or `invite_link` already exists)

---

## 5. `PATCH /api/admin/channels/:id`

Edit an existing channel. Any subset of fields may be supplied. Used by the bot's `/edit` command.

### Body (all optional)

```json
{
  "username": "updated_handle",
  "invite_link": null,
  "title": "Updated Title",
  "is_active": false
}
```

### Request

```
PATCH /api/admin/channels/7
X-API-Key: sk_live_xxxxx
```

### Response — `200 OK`

Full updated channel object.

### Errors

- `400` — validation
- `404` — not found

---

## 6. `DELETE /api/admin/channels/:id`

Remove a channel. Used by the bot's `/delete` command.

### Query params

| Name | Type | Description |
|---|---|---|
| `hard` | bool | If `true`, hard-delete the row. Defaults to `false` (soft-delete: sets `is_active=false`). |

### Request

```
DELETE /api/admin/channels/7
X-API-Key: sk_live_xxxxx
```

### Response — `204 No Content`

### Errors

- `404` — not found

**Note**: prefer soft-delete by default so historical messages keep a valid `channel_id` reference. Hard delete only when a channel was added by mistake.

---

# Notes for the backend developer

- All 6 endpoints use the same `X-API-Key` auth header. No bearer tokens, no login endpoint, no user accounts on the backend.
- Admin identity (who can run `/add` / `/edit` / `/delete`) is enforced by the Telegram bot inside `promo-listener` using a Telegram-user-ID whitelist. The backend just trusts whoever has the API key.
- The listener never writes to your database directly — only via these endpoints.
- The listener applies a cheap codebase pre-filter and OpenAI promo classification before calling `POST /api/messages`. The classifier result is included in every payload — store it.
- The listener does not host or forward media files. Only the text and classification fields are sent.
- The `raw` field contains the entire GramJS message object as JSON (bigints serialized to strings). Store it (suggested column: `jsonb`) — useful for surfacing extra fields on the site later without re-running the listener.
- Channels are added/edited/deleted via the admin endpoints (3-6). The listener polls `GET /api/channels` every ~3 min and joins/leaves Telegram channels automatically as the table changes.
- Idempotency on `POST /api/messages` is mandatory. The listener's retry queue may re-POST the same `(channel_id, message_id)` after a transient failure.
