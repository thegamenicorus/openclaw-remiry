import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initDb } from "../src/db.js";
import { registerRoutes } from "../src/routes.js";
import type { RemiryDb } from "../src/db.js";

// Minimal in-process route runner — captures registered routes and calls them directly
type Handler = (req: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown }) => unknown;

function buildRouter(db: RemiryDb) {
  const routes: Map<string, Handler> = new Map();
  const api = {
    registerHttpRoute(opts: { method: string; path: string; auth: string; handler: Handler }) {
      routes.set(`${opts.method} ${opts.path}`, opts.handler);
    },
  };
  registerRoutes(api, db);

  return {
    call(method: string, path: string, opts: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown } = {}) {
      const handler = routes.get(`${method} ${path}`);
      if (!handler) throw new Error(`No route: ${method} ${path}`);
      return handler(opts) as { status: number; body: { success: boolean; data?: unknown; error?: string } };
    },
  };
}

describe("GET /remiry/items", () => {
  test("returns empty list initially", () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = router.call("GET", "/remiry/items");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, []);
  });

  test("returns all items", () => {
    const db = initDb(":memory:");
    db.create({ type: "remind", name: "A", target_date: "2026-04-01" });
    db.create({ type: "expire", name: "B", target_date: "2026-04-02" });
    const router = buildRouter(db);
    const res = router.call("GET", "/remiry/items");
    assert.equal(res.status, 200);
    assert.equal((res.body.data as unknown[]).length, 2);
  });

  test("filters by type=remind", () => {
    const db = initDb(":memory:");
    db.create({ type: "remind", name: "Event", target_date: "2026-04-01" });
    db.create({ type: "expire", name: "Food", target_date: "2026-04-02" });
    const router = buildRouter(db);
    const res = router.call("GET", "/remiry/items", { query: { type: "remind" } });
    assert.equal(res.status, 200);
    assert.equal((res.body.data as unknown[]).length, 1);
  });

  test("rejects invalid type", () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = router.call("GET", "/remiry/items", { query: { type: "invalid" } });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });
});

describe("GET /remiry/items/:id", () => {
  test("returns item by id", () => {
    const db = initDb(":memory:");
    const item = db.create({ type: "remind", name: "Test", target_date: "2026-04-01" });
    const router = buildRouter(db);
    const res = router.call("GET", "/remiry/items/:id", { params: { id: String(item.id) } });
    assert.equal(res.status, 200);
    assert.equal((res.body.data as { name: string }).name, "Test");
  });

  test("returns 404 for missing id", () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = router.call("GET", "/remiry/items/:id", { params: { id: "9999" } });
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });

  test("returns 400 for invalid id", () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = router.call("GET", "/remiry/items/:id", { params: { id: "abc" } });
    assert.equal(res.status, 400);
  });
});

describe("POST /remiry/items", () => {
  test("creates a remind item", () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = router.call("POST", "/remiry/items", {
      body: { type: "remind", name: "Meeting", target_date: "2026-04-10 09:00" },
    });
    assert.equal(res.status, 201);
    assert.equal((res.body.data as { name: string }).name, "Meeting");
  });

  test("creates an expire item with bbf", () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = router.call("POST", "/remiry/items", {
      body: { type: "expire", name: "Milk", target_date: "2026-04-02", bbf: true },
    });
    assert.equal(res.status, 201);
    assert.equal((res.body.data as { bbf: boolean }).bbf, true);
  });

  test("rejects missing name", () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = router.call("POST", "/remiry/items", {
      body: { type: "remind", target_date: "2026-04-10" },
    });
    assert.equal(res.status, 400);
  });

  test("rejects invalid target_date format", () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = router.call("POST", "/remiry/items", {
      body: { type: "remind", name: "Test", target_date: "not-a-date" },
    });
    assert.equal(res.status, 400);
  });

  test("rejects date-only target_date for remind type", () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = router.call("POST", "/remiry/items", {
      body: { type: "remind", name: "Test", target_date: "2026-04-10" },
    });
    assert.equal(res.status, 400);
  });

  test("accepts datetime target_date for remind type", () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = router.call("POST", "/remiry/items", {
      body: { type: "remind", name: "Test", target_date: "2026-04-10 14:30" },
    });
    assert.equal(res.status, 201);
  });

  test("rejects invalid type", () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = router.call("POST", "/remiry/items", {
      body: { type: "wrong", name: "Test", target_date: "2026-04-10" },
    });
    assert.equal(res.status, 400);
  });

  test("accepts base64 image and returns file path", () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const imageB64 = Buffer.from("fake-image").toString("base64");
    const res = router.call("POST", "/remiry/items", {
      body: { type: "expire", name: "Cheese", target_date: "2026-04-20", image: imageB64 },
    });
    assert.equal(res.status, 201);
    // image comes back as a file path string
    assert.ok(typeof (res.body.data as { image: string }).image === "string");
  });
});

describe("PUT /remiry/items/:id", () => {
  test("updates item name", () => {
    const db = initDb(":memory:");
    const item = db.create({ type: "remind", name: "Old", target_date: "2026-04-01" });
    const router = buildRouter(db);
    const res = router.call("PUT", "/remiry/items/:id", {
      params: { id: String(item.id) },
      body: { name: "New" },
    });
    assert.equal(res.status, 200);
    assert.equal((res.body.data as { name: string }).name, "New");
  });

  test("returns 404 for missing id", () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = router.call("PUT", "/remiry/items/:id", {
      params: { id: "9999" },
      body: { name: "x" },
    });
    assert.equal(res.status, 404);
  });
});

describe("DELETE /remiry/items/:id", () => {
  test("deletes existing item", () => {
    const db = initDb(":memory:");
    const item = db.create({ type: "remind", name: "Gone", target_date: "2026-04-01" });
    const router = buildRouter(db);
    const res = router.call("DELETE", "/remiry/items/:id", { params: { id: String(item.id) } });
    assert.equal(res.status, 200);
    assert.equal((res.body.data as { deleted: boolean }).deleted, true);
  });

  test("returns 404 for missing id", () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = router.call("DELETE", "/remiry/items/:id", { params: { id: "9999" } });
    assert.equal(res.status, 404);
  });
});

describe("GET /remiry/upcoming/events", () => {
  test("returns upcoming remind items", () => {
    const db = initDb(":memory:");
    const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    db.create({ type: "remind", name: "Soon", target_date: soon });
    const router = buildRouter(db);
    const res = router.call("GET", "/remiry/upcoming/events");
    assert.equal(res.status, 200);
    assert.equal((res.body.data as unknown[]).length, 1);
  });

  test("respects custom days param", () => {
    const db = initDb(":memory:");
    const in20 = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    db.create({ type: "remind", name: "Later", target_date: in20 });
    const router = buildRouter(db);
    const defaultRes = router.call("GET", "/remiry/upcoming/events", { query: { days: "7" } });
    assert.equal((defaultRes.body.data as unknown[]).length, 0);
    const wideRes = router.call("GET", "/remiry/upcoming/events", { query: { days: "30" } });
    assert.equal((wideRes.body.data as unknown[]).length, 1);
  });

  test("rejects negative days", () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = router.call("GET", "/remiry/upcoming/events", { query: { days: "-1" } });
    assert.equal(res.status, 400);
  });
});

describe("GET /remiry/upcoming/expiry", () => {
  test("returns upcoming expire items", () => {
    const db = initDb(":memory:");
    const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    db.create({ type: "expire", name: "Yogurt", target_date: soon });
    const router = buildRouter(db);
    const res = router.call("GET", "/remiry/upcoming/expiry");
    assert.equal(res.status, 200);
    assert.equal((res.body.data as unknown[]).length, 1);
  });
});

describe("DELETE /remiry/items (clear all)", () => {
  test("clears all items with confirm=true", () => {
    const db = initDb(":memory:");
    db.create({ type: "remind", name: "A", target_date: "2026-04-01 09:00" });
    db.create({ type: "expire", name: "B", target_date: "2026-04-02" });
    const router = buildRouter(db);
    const res = router.call("DELETE", "/remiry/items", { query: { confirm: "true" } });
    assert.equal(res.status, 200);
    assert.equal((res.body.data as { deleted: number }).deleted, 2);
    assert.equal(db.getAll().length, 0);
  });

  test("rejects without confirm=true", () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = router.call("DELETE", "/remiry/items", {});
    assert.equal(res.status, 400);
  });
});

describe("GET /remiry/summary", () => {
  test("returns on_date and upcoming sections", () => {
    const db = initDb(":memory:");
    db.create({ type: "remind", name: "Morning",  target_date: "2026-04-15 09:00" });
    db.create({ type: "expire", name: "Milk",     target_date: "2026-04-15" });
    db.create({ type: "remind", name: "Next day", target_date: "2026-04-16 10:00" });
    db.create({ type: "expire", name: "Cheese",   target_date: "2026-04-18" });
    const router = buildRouter(db);
    const res = router.call("GET", "/remiry/summary", { query: { date: "2026-04-15", upcoming_days: "7" } });
    assert.equal(res.status, 200);
    const data = res.body.data as { on_date: { events: unknown[]; expiry: unknown[] }; upcoming: { events: unknown[]; expiry: unknown[] } };
    assert.equal(data.on_date.events.length, 1);
    assert.equal(data.on_date.expiry.length, 1);
    assert.equal(data.upcoming.events.length, 1);
    assert.equal(data.upcoming.expiry.length, 1);
  });

  test("defaults to today when date omitted", () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = router.call("GET", "/remiry/summary");
    assert.equal(res.status, 200);
    const data = res.body.data as { date: string };
    assert.equal(data.date, new Date().toISOString().slice(0, 10));
  });

  test("rejects invalid date format", () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = router.call("GET", "/remiry/summary", { query: { date: "not-a-date" } });
    assert.equal(res.status, 400);
  });

  test("rejects negative upcoming_days", () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = router.call("GET", "/remiry/summary", { query: { date: "2026-04-15", upcoming_days: "-1" } });
    assert.equal(res.status, 400);
  });
});
