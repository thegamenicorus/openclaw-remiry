import pkg from "node-sqlite3-wasm";
const { Database } = pkg as unknown as { Database: new (path: string) => import("node-sqlite3-wasm").Database };
import { homedir } from "node:os";
import { join } from "node:path";

export type ItemType = "remind" | "expire";

export interface Item {
  id: number;
  type: ItemType;
  name: string;
  desc: string | null;
  image: Buffer | null;
  bbf: number; // 0 = false, 1 = true (best-before flag, relevant for expire type)
  active_date: string; // ISO date string YYYY-MM-DD
  target_date: string; // ISO date string YYYY-MM-DD
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

export interface RemiryDb {
  getAll(type?: ItemType): Item[];
  getById(id: number): Item | undefined;
  create(input: CreateItemInput): Item;
  update(id: number, input: UpdateItemInput): Item | undefined;
  remove(id: number): boolean;
  upcomingEvents(days: number): Item[];
  upcomingExpiry(days: number): Item[];
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT    NOT NULL CHECK(type IN ('remind','expire')),
    name        TEXT    NOT NULL,
    desc        TEXT,
    image       BLOB,
    bbf         INTEGER NOT NULL DEFAULT 0,
    active_date TEXT    NOT NULL DEFAULT (date('now')),
    target_date TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`;

// node-sqlite3-wasm returns null (not undefined) for missing rows,
// and returns BLOBs as Uint8Array instead of Buffer.
function normalize(row: unknown): Item | undefined {
  if (row == null) return undefined;
  const item = row as Item;
  if (item.image != null) {
    item.image = Buffer.from(item.image as unknown as Uint8Array);
  }
  return item;
}

function toUint8Array(buf: Buffer | null | undefined): Uint8Array | null {
  if (buf == null) return null;
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function initDb(dbPath?: string): RemiryDb {
  const resolvedPath = dbPath ?? join(homedir(), ".openclaw", "remiry.db");
  const db = new Database(resolvedPath);
  db.exec(CREATE_TABLE_SQL);

  return {
    getAll(type?: ItemType): Item[] {
      const rows = type
        ? db.prepare("SELECT * FROM items WHERE type = ? ORDER BY target_date ASC").all(type)
        : db.prepare("SELECT * FROM items ORDER BY target_date ASC").all();
      return rows.map(normalize).filter((r): r is Item => r !== undefined);
    },

    getById(id: number): Item | undefined {
      return normalize(db.prepare("SELECT * FROM items WHERE id = ?").get(id));
    },

    create(input: CreateItemInput): Item {
      const today = new Date().toISOString().slice(0, 10);
      const result = db.prepare(`
        INSERT INTO items (type, name, desc, image, bbf, active_date, target_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run([
        input.type,
        input.name,
        input.desc ?? null,
        toUint8Array(input.image ?? null),
        input.bbf ? 1 : 0,
        input.active_date ?? today,
        input.target_date,
      ]);
      return this.getById(result.lastInsertRowid as number)!;
    },

    update(id: number, input: UpdateItemInput): Item | undefined {
      const existing = this.getById(id);
      if (!existing) return undefined;

      const fields: string[] = ["updated_at = datetime('now')"];
      const values: unknown[] = [];

      if (input.type !== undefined) { fields.push("type = ?"); values.push(input.type); }
      if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
      if ("desc" in input) { fields.push("desc = ?"); values.push(input.desc ?? null); }
      if ("image" in input) { fields.push("image = ?"); values.push(toUint8Array(input.image ?? null)); }
      if (input.bbf !== undefined) { fields.push("bbf = ?"); values.push(input.bbf ? 1 : 0); }
      if (input.active_date !== undefined) { fields.push("active_date = ?"); values.push(input.active_date); }
      if (input.target_date !== undefined) { fields.push("target_date = ?"); values.push(input.target_date); }

      values.push(id);
      db.prepare(`UPDATE items SET ${fields.join(", ")} WHERE id = ?`).run(values);
      return this.getById(id);
    },

    remove(id: number): boolean {
      const result = db.prepare("DELETE FROM items WHERE id = ?").run([id]);
      return result.changes > 0;
    },

    upcomingEvents(days: number): Item[] {
      const rows = db.prepare(`
        SELECT * FROM items
        WHERE type = 'remind'
          AND target_date >= date('now')
          AND target_date <= date('now', '+' || ? || ' days')
        ORDER BY target_date ASC
      `).all(days);
      return rows.map(normalize).filter((r): r is Item => r !== undefined);
    },

    upcomingExpiry(days: number): Item[] {
      const rows = db.prepare(`
        SELECT * FROM items
        WHERE type = 'expire'
          AND target_date >= date('now')
          AND target_date <= date('now', '+' || ? || ' days')
        ORDER BY target_date ASC
      `).all(days);
      return rows.map(normalize).filter((r): r is Item => r !== undefined);
    },
  };
}
