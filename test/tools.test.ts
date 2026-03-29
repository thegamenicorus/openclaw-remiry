import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { initDb } from "../src/db.js";
import { registerTools } from "../src/tools.js";
import type { RemiryDb } from "../src/db.js";

type ToolResult = { content: Array<{ type: string; text: string }> };

type RegisteredTool = {
  execute(id: string, params: Record<string, unknown>): Promise<ToolResult>;
};

function buildTools(db: RemiryDb) {
  const tools = new Map<string, RegisteredTool>();
  const api = {
    registerTool(tool: { name: string } & RegisteredTool) {
      tools.set(tool.name, tool);
    },
  };
  registerTools(api, db);

  return {
    async call(name: string, params: Record<string, unknown> = {}) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`No tool: ${name}`);
      const result = await tool.execute("test", params);
      return JSON.parse(result.content[0].text) as Record<string, unknown>;
    },
  };
}

describe("remiry_create_item tool", () => {
  test("creates a remind item", async () => {
    const db = initDb(":memory:");
    const tools = buildTools(db);
    const result = await tools.call("remiry_create_item", {
      type: "remind",
      name: "Meeting",
      target_date: "2026-04-10",
    });
    assert.equal(result.created, true);
    assert.equal((result.item as { name: string }).name, "Meeting");
  });

  test("creates an expire item with bbf", async () => {
    const db = initDb(":memory:");
    const tools = buildTools(db);
    const result = await tools.call("remiry_create_item", {
      type: "expire",
      name: "Milk",
      target_date: "2026-04-02",
      bbf: true,
    });
    assert.equal((result.item as { bbf: boolean }).bbf, true);
  });
});

describe("remiry_list_items tool", () => {
  test("returns all items", async () => {
    const db = initDb(":memory:");
    db.create({ type: "remind", name: "A", target_date: "2026-04-01" });
    db.create({ type: "expire", name: "B", target_date: "2026-04-02" });
    const tools = buildTools(db);
    const result = await tools.call("remiry_list_items");
    assert.equal(result.count, 2);
  });

  test("filters by type", async () => {
    const db = initDb(":memory:");
    db.create({ type: "remind", name: "Event", target_date: "2026-04-01" });
    db.create({ type: "expire", name: "Food", target_date: "2026-04-02" });
    const tools = buildTools(db);
    const result = await tools.call("remiry_list_items", { type: "expire" });
    assert.equal(result.count, 1);
    assert.equal(((result.items as unknown[])[0] as { name: string }).name, "Food");
  });

  test("filters bbf_only", async () => {
    const db = initDb(":memory:");
    db.create({ type: "expire", name: "Hard", target_date: "2026-04-01", bbf: false });
    db.create({ type: "expire", name: "BBF", target_date: "2026-04-02", bbf: true });
    const tools = buildTools(db);
    const result = await tools.call("remiry_list_items", { bbf_only: true });
    assert.equal(result.count, 1);
    assert.equal(((result.items as unknown[])[0] as { name: string }).name, "BBF");
  });
});

describe("remiry_get_item tool", () => {
  test("returns item by id", async () => {
    const db = initDb(":memory:");
    const item = db.create({ type: "remind", name: "Test", target_date: "2026-04-01" });
    const tools = buildTools(db);
    const result = await tools.call("remiry_get_item", { id: item.id });
    assert.equal((result as { name: string }).name, "Test");
  });

  test("returns error for missing id", async () => {
    const db = initDb(":memory:");
    const tools = buildTools(db);
    const result = await tools.call("remiry_get_item", { id: 9999 });
    assert.ok("error" in result);
  });
});

describe("remiry_update_item tool", () => {
  test("updates item", async () => {
    const db = initDb(":memory:");
    const item = db.create({ type: "remind", name: "Old", target_date: "2026-04-01" });
    const tools = buildTools(db);
    const result = await tools.call("remiry_update_item", { id: item.id, name: "New" });
    assert.equal(result.updated, true);
    assert.equal((result.item as { name: string }).name, "New");
  });

  test("returns error for missing id", async () => {
    const db = initDb(":memory:");
    const tools = buildTools(db);
    const result = await tools.call("remiry_update_item", { id: 9999, name: "x" });
    assert.ok("error" in result);
  });
});

describe("remiry_delete_item tool", () => {
  test("deletes item", async () => {
    const db = initDb(":memory:");
    const item = db.create({ type: "remind", name: "Gone", target_date: "2026-04-01" });
    const tools = buildTools(db);
    const result = await tools.call("remiry_delete_item", { id: item.id });
    assert.equal(result.deleted, true);
    assert.equal(db.getById(item.id), undefined);
  });

  test("returns error for missing id", async () => {
    const db = initDb(":memory:");
    const tools = buildTools(db);
    const result = await tools.call("remiry_delete_item", { id: 9999 });
    assert.ok("error" in result);
  });
});

describe("remiry_upcoming_events tool", () => {
  test("returns upcoming events within default 7 days", async () => {
    const db = initDb(":memory:");
    const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    db.create({ type: "remind", name: "Soon", target_date: soon });
    const tools = buildTools(db);
    const result = await tools.call("remiry_upcoming_events");
    assert.equal(result.count, 1);
    assert.equal(result.days, 7);
  });

  test("respects custom days", async () => {
    const db = initDb(":memory:");
    const in20 = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    db.create({ type: "remind", name: "Later", target_date: in20 });
    const tools = buildTools(db);
    const narrow = await tools.call("remiry_upcoming_events", { days: 7 });
    assert.equal(narrow.count, 0);
    const wide = await tools.call("remiry_upcoming_events", { days: 30 });
    assert.equal(wide.count, 1);
  });
});

describe("remiry_upcoming_expiry tool", () => {
  test("returns upcoming expiry items", async () => {
    const db = initDb(":memory:");
    const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    db.create({ type: "expire", name: "Hard", target_date: soon, bbf: false });
    db.create({ type: "expire", name: "BBF", target_date: soon, bbf: true });
    const tools = buildTools(db);
    const all = await tools.call("remiry_upcoming_expiry");
    assert.equal(all.count, 2);
  });

  test("filters bbf_only=true", async () => {
    const db = initDb(":memory:");
    const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    db.create({ type: "expire", name: "Hard", target_date: soon, bbf: false });
    db.create({ type: "expire", name: "BBF", target_date: soon, bbf: true });
    const tools = buildTools(db);
    const result = await tools.call("remiry_upcoming_expiry", { bbf_only: true });
    assert.equal(result.count, 1);
    assert.equal(((result.items as unknown[])[0] as { name: string }).name, "BBF");
  });

  test("filters bbf_only=false (hard expiry only)", async () => {
    const db = initDb(":memory:");
    const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    db.create({ type: "expire", name: "Hard", target_date: soon, bbf: false });
    db.create({ type: "expire", name: "BBF", target_date: soon, bbf: true });
    const tools = buildTools(db);
    const result = await tools.call("remiry_upcoming_expiry", { bbf_only: false });
    assert.equal(result.count, 1);
    assert.equal(((result.items as unknown[])[0] as { name: string }).name, "Hard");
  });
});
