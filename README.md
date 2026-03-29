# OpenClaw Remiry

An [OpenClaw](https://docs.openclaw.ai/) plugin for tracking **event reminders** and **item expiry / best-before dates**, backed by a local SQLite database.

---

## Features

- Track upcoming **events** (dentist appointments, deadlines, birthdays, etc.)
- Track **expiry dates** for physical/digital items
- Mark items as **best-before** (BBF) instead of hard expiry
- Attach optional descriptions and images (stored as binary blobs)
- REST API for direct access from any HTTP client
- Agent tools so Claude can manage your items conversationally
- Ships with an OpenClaw skill that auto-loads into the agent

---

## Installation

### Prerequisites

- Node.js 22+ (LTS recommended)
- [OpenClaw](https://docs.openclaw.ai/) installed and running

### Install the plugin

```bash
# From the plugin directory
openclaw plugins install ./

# Or, once published to ClawHub/npm:
openclaw plugins install openclaw-remiry
```

### Install dependencies (for development)

```bash
npm install
```

---

## Configuration

Optional config in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "remiry": {
      "dbPath": "/custom/path/to/remiry.db"
    }
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `dbPath` | `~/.openclaw/remiry.db` | Path to the SQLite database file |

---

## REST API

All routes are served by OpenClaw at `http://127.0.0.1:18789` (default gateway address).

### Items CRUD

#### List items
```
GET /remiry/items
GET /remiry/items?type=remind
GET /remiry/items?type=expire
```

#### Get a single item
```
GET /remiry/items/:id
```

#### Create an item
```
POST /remiry/items
Content-Type: application/json

{
  "type": "remind",           // "remind" | "expire" (required)
  "name": "Dentist",          // string (required)
  "target_date": "2026-04-15",// YYYY-MM-DD (required)
  "desc": "Annual checkup",   // string (optional)
  "bbf": false,               // boolean (optional, expire type only)
  "active_date": "2026-03-29",// YYYY-MM-DD (optional, default: today)
  "image": "<base64 string>"  // optional, base64-encoded image
}
```

#### Update an item
```
PUT /remiry/items/:id
Content-Type: application/json

{
  "name": "Updated name",
  "target_date": "2026-05-01"
}
```
Only include fields you want to change.

#### Delete an item
```
DELETE /remiry/items/:id
```

### Upcoming queries

#### Upcoming events (remind type)
```
GET /remiry/upcoming/events
GET /remiry/upcoming/events?days=14
```
Returns `remind` items whose `target_date` falls within the next N days (default: 7).

#### Upcoming expiry/BBF (expire type)
```
GET /remiry/upcoming/expiry
GET /remiry/upcoming/expiry?days=30
```
Returns `expire` items whose `target_date` falls within the next N days (default: 7). Includes both hard-expiry and best-before items.

### Response format

All endpoints return:
```json
{ "success": true, "data": { ... } }
```
or on error:
```json
{ "success": false, "error": "message" }
```

Images in responses are base64-encoded strings (or `null` if not set).

---

## Database Schema

Stored at `~/.openclaw/remiry.db` (SQLite).

```sql
CREATE TABLE items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT    NOT NULL CHECK(type IN ('remind','expire')),
  name        TEXT    NOT NULL,
  desc        TEXT,
  image       BLOB,
  bbf         INTEGER NOT NULL DEFAULT 0,   -- 1 = best-before flag
  active_date TEXT    NOT NULL DEFAULT (date('now')),
  target_date TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

| Column | Notes |
|--------|-------|
| `type` | `remind` = event reminder; `expire` = expiry/BBF item |
| `bbf` | `1` means best-before (soft recommendation), `0` means hard expiry — only meaningful for `type='expire'` |
| `active_date` | Date when tracking begins (defaults to today) |
| `target_date` | For `remind`: event date. For `expire`: expiry or best-before date |
| `image` | Binary blob; pass base64 via API |

---

## Agent Skill

The plugin ships a skill at `skills/remiry.md` which OpenClaw loads automatically when the plugin is enabled.

Once loaded, Claude will use the `remiry_*` tools when you say things like:

- _"Remind me about the team meeting on April 20"_
- _"Track my yogurt — best before tomorrow"_
- _"What events do I have coming up this week?"_
- _"Anything expiring in the next month?"_
- _"Delete the milk reminder"_

### Manual skill installation (if needed)

If you need to install the skill separately:

```bash
cp skills/remiry.md ~/.openclaw/skills/
```

---

## Agent Tools Reference

All tools are prefixed `remiry_` and are marked `optional` (must be allowlisted by the user).

| Tool | Description |
|------|-------------|
| `remiry_list_items` | List all items; filter by `type` and/or `bbf_only` |
| `remiry_get_item` | Get a single item by `id` |
| `remiry_create_item` | Create a remind or expire item |
| `remiry_update_item` | Update fields of an existing item |
| `remiry_delete_item` | Delete an item by `id` |
| `remiry_upcoming_events` | Remind items within the next N days |
| `remiry_upcoming_expiry` | Expire/BBF items within the next N days |

---

## Development

```bash
# Type-check without building
npm run typecheck

# The plugin runs directly as TypeScript via OpenClaw's runtime
```

### Project structure

```
openclaw-remiry/
├── index.ts              ← Plugin entry point
├── src/
│   ├── db.ts             ← SQLite init and typed query helpers
│   ├── routes.ts         ← HTTP route handlers
│   └── tools.ts          ← Agent tool registrations
├── skills/
│   └── remiry.md         ← OpenClaw skill definition
├── package.json
├── openclaw.plugin.json  ← Plugin manifest
└── tsconfig.json
```

---

## License

MIT
