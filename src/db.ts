import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, tmpdir } from "node:os";

export type ItemType = "remind" | "expire";

export interface Item {
  id: number;
  type: ItemType;
  name: string;
  desc: string | null;
  image: string | null; // absolute file path, or null
  bbf: number; // 0 = false, 1 = true
  active_date: string;
  target_date: string;
  created_at: string;
  updated_at: string;
}

export interface CreateItemInput {
  type: ItemType;
  name: string;
  desc?: string;
  image?: Buffer;
  bbf?: boolean;
  active_date?: string;
  target_date: string;
}

export interface UpdateItemInput {
  type?: ItemType;
  name?: string;
  desc?: string | null;
  image?: Buffer | null;
  bbf?: boolean;
  active_date?: string;
  target_date?: string;
}

export interface SummaryResult {
  date: string;
  upcoming_days: number;
  on_date: { events: Item[]; expiry: Item[] };
  upcoming: { events: Item[]; expiry: Item[] };
}

export interface RemiryDb {
  getAll(type?: ItemType): Item[];
  getById(id: number): Item | undefined;
  create(input: CreateItemInput): Item;
  update(id: number, input: UpdateItemInput): Item | undefined;
  remove(id: number): boolean;
  upcomingEvents(days: number): Item[];
  upcomingExpiry(days: number): Item[];
  summary(date: string, upcomingDays: number): SummaryResult;
  clearAll(): { deleted: number };
  close(): void;
}

// ── Image helpers ─────────────────────────────────────────────────────────────

function detectExtension(buf: Buffer): string {
  if (buf[0] === 0xFF && buf[1] === 0xD8) return "jpg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return "png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "gif";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return "webp";
  return "bin";
}

function saveImageFile(imgDir: string, id: number, buf: Buffer): string {
  if (!existsSync(imgDir)) mkdirSync(imgDir, { recursive: true });
  const filename = `${id}.${detectExtension(buf)}`;
  writeFileSync(join(imgDir, filename), buf);
  return join(imgDir, filename);
}

function deleteImageFile(path: string | null): void {
  if (!path) return;
  try { unlinkSync(path); } catch { /* already gone */ }
}

// ── Schema ────────────────────────────────────────────────────────────────────

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT    NOT NULL CHECK(type IN ('remind','expire')),
    name        TEXT    NOT NULL,
    desc        TEXT,
    image       TEXT,
    bbf         INTEGER NOT NULL DEFAULT 0,
    active_date TEXT    NOT NULL DEFAULT (date('now')),
    target_date TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`;

// ── Init ──────────────────────────────────────────────────────────────────────

export function initDb(dbPath?: string, imagesDir?: string): RemiryDb {
  const resolvedPath = dbPath ?? join(homedir(), ".openclaw", "extensions", "remiry", "remiry.db");
  const inMemory = resolvedPath === ":memory:";
  const imgDir = imagesDir ?? (inMemory
    ? join(tmpdir(), "remiry-test-images")
    : join(homedir(), ".openclaw", "extensions", "remiry", "images"));

  if (!inMemory) {
    const dir = dirname(resolvedPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(resolvedPath);
  db.exec(CREATE_TABLE_SQL);

  return {
    getAll(type?: ItemType): Item[] {
      if (type) {
        return db.prepare("SELECT * FROM items WHERE type = ? ORDER BY target_date ASC").all(type) as Item[];
      }
      return db.prepare("SELECT * FROM items ORDER BY target_date ASC").all() as Item[];
    },

    getById(id: number): Item | undefined {
      return db.prepare("SELECT * FROM items WHERE id = ?").get(id) as Item | undefined;
    },

    create(input: CreateItemInput): Item {
      const today = new Date().toISOString().slice(0, 10);
      const stmt = db.prepare(`
        INSERT INTO items (type, name, desc, image, bbf, active_date, target_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
        input.type,
        input.name,
        input.desc ?? null,
        null, // placeholder — updated below if image provided
        input.bbf ? 1 : 0,
        input.active_date ?? today,
        input.target_date,
      );
      const id = Number(result.lastInsertRowid);

      if (input.image) {
        const imagePath = saveImageFile(imgDir, id, input.image);
        db.prepare("UPDATE items SET image = ? WHERE id = ?").run(imagePath, id);
      }

      return this.getById(id)!;
    },

    update(id: number, input: UpdateItemInput): Item | undefined {
      const existing = this.getById(id);
      if (!existing) return undefined;

      const fields: string[] = ["updated_at = datetime('now')"];
      const values: unknown[] = [];

      if (input.type        !== undefined) { fields.push("type = ?");        values.push(input.type); }
      if (input.name        !== undefined) { fields.push("name = ?");        values.push(input.name); }
      if ("desc"  in input)                { fields.push("desc = ?");        values.push(input.desc ?? null); }
      if (input.bbf         !== undefined) { fields.push("bbf = ?");         values.push(input.bbf ? 1 : 0); }
      if (input.active_date !== undefined) { fields.push("active_date = ?"); values.push(input.active_date); }
      if (input.target_date !== undefined) { fields.push("target_date = ?"); values.push(input.target_date); }

      if ("image" in input) {
        deleteImageFile(existing.image);
        const newPath = input.image ? saveImageFile(imgDir, id, input.image) : null;
        fields.push("image = ?");
        values.push(newPath);
      }

      values.push(id);
      db.prepare(`UPDATE items SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      return this.getById(id);
    },

    remove(id: number): boolean {
      const existing = this.getById(id);
      if (!existing) return false;
      deleteImageFile(existing.image);
      db.prepare("DELETE FROM items WHERE id = ?").run(id);
      return true;
    },

    upcomingEvents(days: number): Item[] {
      return db.prepare(`
        SELECT * FROM items
        WHERE type = 'remind'
          AND datetime(target_date) >= datetime('now')
          AND datetime(target_date) <= datetime('now', '+' || ? || ' days')
        ORDER BY target_date ASC
      `).all(days) as Item[];
    },

    upcomingExpiry(days: number): Item[] {
      return db.prepare(`
        SELECT * FROM items
        WHERE type = 'expire'
          AND target_date >= date('now')
          AND target_date <= date('now', '+' || ? || ' days')
        ORDER BY target_date ASC
      `).all(days) as Item[];
    },

    summary(date: string, upcomingDays: number): SummaryResult {
      const onDateEvents = db.prepare(`
        SELECT * FROM items WHERE type = 'remind' AND date(target_date) = ? ORDER BY target_date ASC
      `).all(date) as Item[];

      const onDateExpiry = db.prepare(`
        SELECT * FROM items WHERE type = 'expire' AND target_date = ? ORDER BY target_date ASC
      `).all(date) as Item[];

      const upcomingEvents = db.prepare(`
        SELECT * FROM items
        WHERE type = 'remind'
          AND date(target_date) > ?
          AND date(target_date) <= date(?, '+' || ? || ' days')
        ORDER BY target_date ASC
      `).all(date, date, upcomingDays) as Item[];

      const upcomingExpiry = db.prepare(`
        SELECT * FROM items
        WHERE type = 'expire'
          AND target_date > ?
          AND target_date <= date(?, '+' || ? || ' days')
        ORDER BY target_date ASC
      `).all(date, date, upcomingDays) as Item[];

      return {
        date,
        upcoming_days: upcomingDays,
        on_date: { events: onDateEvents, expiry: onDateExpiry },
        upcoming: { events: upcomingEvents, expiry: upcomingExpiry },
      };
    },

    clearAll(): { deleted: number } {
      // Delete all image files first
      const items = db.prepare("SELECT image FROM items WHERE image IS NOT NULL").all() as { image: string }[];
      items.forEach(row => deleteImageFile(row.image));
      const result = db.prepare("DELETE FROM items").run();
      return { deleted: Number(result.changes) };
    },

    close(): void {
      db.close();
    },
  };
}
