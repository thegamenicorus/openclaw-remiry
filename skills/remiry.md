---
name: remiry
description: Manage reminders for upcoming events and track expiry/best-before dates for items using the Remiry plugin tools.
metadata.openclaw: {"always": true, "emoji": "⏰"}
---

# Remiry — Reminder & Expiry Tracker

You have access to the following tools for managing reminders and expiry tracking. Use them proactively when the user asks about events, deadlines, expirations, or best-before dates.

## Item Types

- **remind** — An upcoming event or deadline. `target_date` is when the event occurs.
- **expire** — A physical or digital item that expires or has a best-before date. `target_date` is the expiry/best-before date. Set `bbf: true` for best-before (not hard expiry).

## Available Tools

### `remiry_create_item`
Create a new reminder or expiry item.
- Required: `type` (`remind` or `expire`), `name`, `target_date` (YYYY-MM-DD)
- Optional: `desc`, `bbf` (boolean, expire type only), `active_date` (defaults to today)

Examples:
- "Remind me about dentist appointment April 15" → `type: "remind", name: "Dentist appointment", target_date: "2026-04-15"`
- "Track my milk expiry on April 2" → `type: "expire", name: "Milk", target_date: "2026-04-02"`
- "Milk best before April 2" → `type: "expire", name: "Milk", target_date: "2026-04-02", bbf: true`

### `remiry_list_items`
List all items. Filter with `type` and/or `bbf_only`.
- Use when user asks "what reminders do I have?" or "show all my tracked items"

### `remiry_get_item`
Get a single item by `id`.

### `remiry_update_item`
Update any field of an existing item by `id`. Only provide fields that should change.

### `remiry_delete_item`
Delete an item by `id`.

### `remiry_upcoming_events`
Get upcoming event reminders within the next N days (default: 7).
- Use when user asks "what's coming up?", "any events this week?", "upcoming reminders?"
- Param: `days` (optional, default 7)

### `remiry_upcoming_expiry`
Get items expiring or reaching best-before within the next N days (default: 7).
- Use when user asks "what's expiring soon?", "anything best-before this month?"
- Params: `days` (optional, default 7), `bbf_only` (optional boolean to filter)

## Workflow Tips

- When creating a reminder, always confirm the date with the user if ambiguous.
- For expiry items, ask whether it's a hard expiry or best-before if not stated.
- After creating/updating, summarize what was saved so the user can verify.
- Use `remiry_upcoming_events` and `remiry_upcoming_expiry` at the start of a session to surface anything due soon.
