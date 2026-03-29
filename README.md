# OpenClaw Remiry

An [OpenClaw](https://docs.openclaw.ai/) plugin for tracking **event reminders** and **item expiry / best-before dates**, backed by a local SQLite database (Node.js built-in `node:sqlite` — no native compilation required).

---

## Features

- Track upcoming **events** with date and time (dentist appointments, deadlines, birthdays, etc.)
- Track **expiry dates** for physical/digital items
- Distinguish **best-before** (BBF) from hard expiry
- Attach optional descriptions and images (saved as files, path stored in DB)
- One-stop **summary endpoint** — events and expiry for a date + upcoming window in one call
- Full REST API for direct access from any HTTP client
- Agent tools so Claude can manage your items conversationally
- Ships with an OpenClaw skill that auto-loads into the agent

---

## Requirements

- Node.js **22.5.0 or later** (uses built-in `node:sqlite`)
- [OpenClaw](https://docs.openclaw.ai/) installed and running

---

## Installation

```bash
# From the plugin directory
openclaw plugins install ./

# Or, once published to ClawHub/npm:
openclaw plugins install openclaw-remiry
```

No `npm install` needed in production — zero runtime dependencies.

---

## Data Storage

All plugin data is stored under `~/.openclaw/extensions/remiry/`:

```
~/.openclaw/extensions/remiry/
├── remiry.db       ← SQLite database
└── images/         ← image files
    ├── 1.jpg
    ├── 2.png
    └── ...
```

---

## Configuration

Optional. Add to `~/.openclaw/openclaw.json` only if you want custom paths:

```json
{
  "plugins": {
    "remiry": {
      "dbPath": "/custom/path/remiry.db",
      "imagesDir": "/custom/path/images"
    }
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `dbPath` | `~/.openclaw/extensions/remiry/remiry.db` | SQLite database file |
| `imagesDir` | `~/.openclaw/extensions/remiry/images` | Directory for stored images |

---

## REST API

All routes are served by OpenClaw at `http://127.0.0.1:18789` (default gateway address).

Routes use `auth: "plugin"` — no Authorization header required.

### Health check

```
GET /remiry/health
```

Returns `{ "success": true, "data": { "status": "ok", "items": N } }`. Use this to confirm the plugin is loaded and the database is accessible.

---

### One-stop Summary ⭐

```
GET /remiry/summary
GET /remiry/summary?date=YYYY-MM-DD&upcoming_days=7
```

Returns events and expiry items **on** the given date, plus items coming up within the next N days. This is the primary endpoint — use it first.

```json
{
  "success": true,
  "data": {
    "date": "2026-04-15",
    "upcoming_days": 7,
    "on_date": {
      "events": [...],
      "expiry": [...]
    },
    "upcoming": {
      "events": [...],
      "expiry": [...]
    }
  }
}
```

| Param | Default | Description |
|-------|---------|-------------|
| `date` | today | Focus date in `YYYY-MM-DD` |
| `upcoming_days` | `7` | Days ahead to look for upcoming items |

---

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
```

```json
{
  "type": "remind",
  "name": "Dentist",
  "target_date": "2026-04-15 10:00",
  "desc": "Annual checkup",
  "active_date": "2026-03-29",
  "image": "<base64 string>"
}
```

```json
{
  "type": "expire",
  "name": "Milk",
  "target_date": "2026-04-02",
  "bbf": true,
  "image": "<base64 string>"
}
```

**`target_date` format:**
- `remind` → `YYYY-MM-DD HH:MM` (date + time required)
- `expire` → `YYYY-MM-DD` (date only)

**`bbf` (best-before flag):**
- `false` (default) — hard expiry: item is unsafe/unusable after this date (medicine, raw meat, "use by")
- `true` — best-before: quality may decline but item is still usable (milk, snacks, "best by")

#### Update an item
```
PUT /remiry/items/:id
Content-Type: application/json
```
Only include fields you want to change.

#### Delete an item
```
DELETE /remiry/items/:id
```

#### Clear all items
```
DELETE /remiry/items?confirm=true
```
Deletes all items and their image files. The `confirm=true` query param is required as a safeguard.

---

### Upcoming queries

#### Upcoming events
```
GET /remiry/upcoming/events
GET /remiry/upcoming/events?days=14
```
Returns `remind` items from now within the next N days (default: 7).

#### Upcoming expiry / BBF
```
GET /remiry/upcoming/expiry
GET /remiry/upcoming/expiry?days=30
```
Returns `expire` items within the next N days (default: 7). Includes both hard-expiry and best-before items.

---

### Response format

Success:
```json
{ "success": true, "data": { ... } }
```

Error:
```json
{ "success": false, "error": "message" }
```

Images in responses are returned as absolute file paths (e.g. `"/home/you/.openclaw/extensions/remiry/images/1.jpg"`), or `null` if not set.

---

## Database Schema

```sql
CREATE TABLE items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT    NOT NULL CHECK(type IN ('remind','expire')),
  name        TEXT    NOT NULL,
  desc        TEXT,
  image       TEXT,                              -- absolute file path or null
  bbf         INTEGER NOT NULL DEFAULT 0,        -- 1 = best-before, 0 = hard expiry
  active_date TEXT    NOT NULL DEFAULT (date('now')),
  target_date TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

| Column | Notes |
|--------|-------|
| `type` | `remind` = event; `expire` = expiry/BBF item |
| `bbf` | `1` = best-before, `0` = hard expiry — only for `type='expire'` |
| `active_date` | Date tracking begins (defaults to today) |
| `target_date` | `remind`: `YYYY-MM-DD HH:MM`. `expire`: `YYYY-MM-DD` |
| `image` | File path to image in `imagesDir`, or `null` |

---

## Agent Skill

The plugin ships `skills/remiry.md` which OpenClaw loads automatically when the plugin is enabled.

Claude will use `remiry_*` tools when you say things like:

- _"What's on today?"_
- _"Remind me about the team meeting on April 20 at 2pm"_
- _"Track my yogurt — best before tomorrow"_
- _"Anything expiring in the next month?"_
- _"Show me this week's schedule"_
- _"Clear everything and start fresh"_

---

## Agent Tools Reference

All tools are prefixed `remiry_` and marked `optional` (must be allowlisted).

| Tool | Description |
|------|-------------|
| `remiry_summary` | ⭐ One-stop fetch: events + expiry on a date and upcoming window |
| `remiry_create_item` | Create a remind or expire item |
| `remiry_update_item` | Update fields of an existing item |
| `remiry_delete_item` | Delete an item by `id` |
| `remiry_clear_all` | Delete all items (requires `confirm: true`) |
| `remiry_list_items` | List all items; filter by `type` and/or `bbf_only` |
| `remiry_get_item` | Get a single item by `id` |
| `remiry_upcoming_events` | Remind items within the next N days from today |
| `remiry_upcoming_expiry` | Expire/BBF items within the next N days from today |

---

## Development

```bash
npm install       # install dev deps (tsx, typescript)
npm test          # run all tests (node:test, no build step)
npm run typecheck # TypeScript check without building
npm run dev       # start local dev server at http://localhost:3000
```

### Dev server

```bash
npm run dev
```

Starts a local HTTP server backed by `dev.db` in the project root. Prints ready-to-paste `curl` commands on startup. Data persists across restarts.

### Project structure

```
openclaw-remiry/
├── index.ts              ← Plugin entry point
├── dev-server.ts         ← Local dev/test server (npm run dev)
├── src/
│   ├── db.ts             ← SQLite (node:sqlite) init and query helpers
│   ├── routes.ts         ← HTTP route handlers (Node.js req/res, auth: "plugin")
│   └── tools.ts          ← Agent tool registrations
├── skills/
│   └── remiry.md         ← OpenClaw skill definition
├── test/
│   ├── db.test.ts
│   ├── routes.test.ts
│   └── tools.test.ts
├── package.json
├── openclaw.plugin.json  ← Plugin manifest
└── tsconfig.json
```

---

## License

MIT
