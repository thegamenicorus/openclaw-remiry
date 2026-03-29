import Database from "better-sqlite3";
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
  db: Database.Database;
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

export function initDb(dbPath?: string): RemiryDb {
  const resolvedPath = dbPath ?? join(homedir(), ".openclaw", "remiry.db");
  const db = new Database(resolvedPath);
  db.exec(CREATE_TABLE_SQL);

  return {
    db,

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
        VALUES (@type, @name, @desc, @image, @bbf, @active_date, @target_date)
      `);
      const result = stmt.run({
        type: input.type,
        name: input.name,
        desc: input.desc ?? null,
        image: input.image ?? null,
        bbf: input.bbf ? 1 : 0,
        active_date: input.active_date ?? today,
        target_date: input.target_date,
      });
      return this.getById(result.lastInsertRowid as number)!;
    },

    update(id: number, input: UpdateItemInput): Item | undefined {
      const existing = this.getById(id);
      if (!existing) return undefined;

      const fields: string[] = ["updated_at = datetime('now')"];
      const values: Record<string, unknown> = { id };

      if (input.type !== undefined) { fields.push("type = @type"); values.type = input.type; }
      if (input.name !== undefined) { fields.push("name = @name"); values.name = input.name; }
      if ("desc" in input) { fields.push("desc = @desc"); values.desc = input.desc ?? null; }
      if ("image" in input) { fields.push("image = @image"); values.image = input.image ?? null; }
      if (input.bbf !== undefined) { fields.push("bbf = @bbf"); values.bbf = input.bbf ? 1 : 0; }
      if (input.active_date !== undefined) { fields.push("active_date = @active_date"); values.active_date = input.active_date; }
      if (input.target_date !== undefined) { fields.push("target_date = @target_date"); values.target_date = input.target_date; }

      db.prepare(`UPDATE items SET ${fields.join(", ")} WHERE id = @id`).run(values);
      return this.getById(id);
    },

    remove(id: number): boolean {
      const result = db.prepare("DELETE FROM items WHERE id = ?").run(id);
      return result.changes > 0;
    },

    upcomingEvents(days: number): Item[] {
      return db.prepare(`
        SELECT * FROM items
        WHERE type = 'remind'
          AND target_date >= date('now')
          AND target_date <= date('now', '+' || ? || ' days')
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
  };
}
