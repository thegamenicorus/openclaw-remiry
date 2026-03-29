---
name: remiry
description: Manage reminders for upcoming events and track expiry/best-before dates. Use remiry_summary as the primary tool to get a full picture for any date.
metadata.openclaw: {"always": false, "emoji": "⏰"}
---

# Remiry — Reminder & Expiry Tracker

## Primary Tool: `remiry_summary`

**Always call this first** when the user asks anything time-related: schedule, upcoming events, what's expiring, what's on a specific day, weekly overview, etc.

Parameters:
- `date` — focus date in `YYYY-MM-DD` format (default: today)
- `upcoming_days` — how many days ahead to include in the upcoming section (default: 7)

Returns two non-overlapping sections:
- `on_date` — events and expiry items **exactly on** the given date
- `upcoming` — events and expiry items **strictly after** the date, within the next N days

Examples:
- "What's on today?" → `remiry_summary()` (no params, defaults to today + 7 days ahead)
- "Show me this week" → `remiry_summary({ upcoming_days: 7 })`
- "What's happening on April 15?" → `remiry_summary({ date: "2026-04-15" })`
- "Anything expiring this month?" → `remiry_summary({ upcoming_days: 30 })`

---

## Item Types

- **remind** — An upcoming event or deadline. `target_date` format: `YYYY-MM-DD HH:MM`
- **expire** — A physical or digital item that expires or has a best-before date. `target_date` format: `YYYY-MM-DD`.

### BBF (Best Before) vs Hard Expiry — both use `type: "expire"`

| | `bbf: false` (default) | `bbf: true` |
|---|---|---|
| Meaning | Item is **unsafe or unusable** after `target_date` | Item is **still usable** but quality may decline after `target_date` |
| Real-world | Medicine, raw meat, contact lenses, coupons | Milk, bread, snacks, cosmetics, batteries |
| Language cues | "expires", "expiry date", "use by", "do not use after" | "best before", "best by", "BB", "recommended to finish by" |

**Rule of thumb:**
- "expires on" / "use by" → `bbf: false` (hard expiry — discard after this date)
- "best before" / "best by" → `bbf: true` (soft recommendation — still okay but quality drops)
- When unsure, ask the user: *"Is this a hard expiry (unsafe after) or best-before (quality guideline)?"*

---

## Other Tools

### `remiry_create_item`
Create a new reminder or expiry item.
- Required: `type` (`remind` or `expire`), `name`, `target_date`
- Optional: `desc`, `bbf` (expire type only), `active_date` (defaults to today)

Examples:
- "Remind me about dentist appointment April 15 at 10am" → `type: "remind", name: "Dentist appointment", target_date: "2026-04-15 10:00"`
- "Track my milk expiry on April 2" → `type: "expire", name: "Milk", target_date: "2026-04-02"`
- "Milk best before April 2" → `type: "expire", name: "Milk", target_date: "2026-04-02", bbf: true`

### `remiry_update_item`
Update any field of an existing item by `id`. Only provide fields that should change.

### `remiry_delete_item`
Delete an item by `id`.

### `remiry_list_items`
List all items. Filter with `type` and/or `bbf_only`.

### `remiry_get_item`
Get a single item by `id`.

### `remiry_upcoming_events`
Get upcoming event reminders within the next N days from **today**.

### `remiry_clear_all`
Delete every item and image. **Always confirm with the user before calling** — this is irreversible.
Pass `confirm: true` to execute.

### `remiry_upcoming_expiry`
Get items expiring or reaching best-before within the next N days from **today**.
Use `bbf_only: true` to filter best-before only, `bbf_only: false` for hard expiry only.

---

## Tips

- After creating or updating an item, confirm what was saved so the user can verify.
- If the user says "remind me" without a time, ask for the time before creating.
- If the user says "best before" / "best by" → `bbf: true`. If they say "expires" / "use by" → `bbf: false`. If ambiguous, ask.
- When reporting expiry items back to the user, distinguish them: say "best before" for `bbf: true` items and "expires" for `bbf: false` items so the user understands the urgency difference.
