import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { initDb } from "../src/db.js";
import { registerRoutes } from "../src/routes.js";
import type { RemiryDb } from "../src/db.js";

type RouteHandler = (req: unknown, res: unknown) => void | Promise<void>;

function buildRouter(db: RemiryDb) {
  const routes: Map<string, RouteHandler> = new Map();
  const api = {
    registerHttpRoute(opts: { path: string; auth: string; handler: RouteHandler }) {
      routes.set(opts.path, opts.handler);
    },
  };
  registerRoutes(api, db);

  return {
    async call(
      method: string,
      path: string,
      opts: {
        params?: Record<string, string>;
        query?: Record<string, string>;
        body?: unknown;
      } = {},
    ): Promise<{ success: boolean; data?: unknown; error?: string }> {
      const handler = routes.get(path);
      if (!handler) throw new Error(`No route: ${path}`);

      // Build a minimal fake IncomingMessage
      const qs = opts.query
        ? "?" + new URLSearchParams(opts.query).toString()
        : "";
      const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : "";
      const readable = Readable.from(bodyStr ? [bodyStr] : []);
      const req = Object.assign(readable, {
        method,
        url: path.replace(/:([^/]+)/g, (_, k) => opts.params?.[k] ?? `:${k}`) + qs,
        params: opts.params ?? {},
        headers: {},
      });

      // Capture the response
      let captured: unknown;
      const res = {
        statusCode: 200,
        json(body: unknown) { captured = body; },
        writeHead(_status: number) {},
        end(body: string) { captured = JSON.parse(body); },
      };

      await handler(req, res);
      return captured as { success: boolean; data?: unknown; error?: string };
    },
  };
}

describe("GET /remiry/items", () => {
  test("returns empty list initially", async () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = await router.call("GET", "/remiry/items");
    assert.equal(res.success, true);
    assert.deepEqual(res.data, []);
  });

  test("returns all items", async () => {
    const db = initDb(":memory:");
    db.create({ type: "remind", name: "A", target_date: "2026-04-01 09:00" });
    db.create({ type: "expire", name: "B", target_date: "2026-04-02" });
    const router = buildRouter(db);
    const res = await router.call("GET", "/remiry/items");
    assert.equal(res.success, true);
    assert.equal((res.data as unknown[]).length, 2);
  });

  test("filters by type=remind", async () => {
    const db = initDb(":memory:");
    db.create({ type: "remind", name: "Event", target_date: "2026-04-01 09:00" });
    db.create({ type: "expire", name: "Food", target_date: "2026-04-02" });
    const router = buildRouter(db);
    const res = await router.call("GET", "/remiry/items", { query: { type: "remind" } });
    assert.equal(res.success, true);
    assert.equal((res.data as unknown[]).length, 1);
  });

  test("rejects invalid type", async () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = await router.call("GET", "/remiry/items", { query: { type: "invalid" } });
    assert.equal(res.success, false);
  });
});

describe("GET /remiry/items/:id", () => {
  test("returns item by id", async () => {
    const db = initDb(":memory:");
    const item = db.create({ type: "remind", name: "Test", target_date: "2026-04-01 09:00" });
    const router = buildRouter(db);
    const res = await router.call("GET", "/remiry/items/:id", { params: { id: String(item.id) } });
    assert.equal(res.success, true);
    assert.equal((res.data as { name: string }).name, "Test");
  });

  test("returns error for missing id", async () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = await router.call("GET", "/remiry/items/:id", { params: { id: "9999" } });
    assert.equal(res.success, false);
  });

  test("returns error for invalid id", async () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = await router.call("GET", "/remiry/items/:id", { params: { id: "abc" } });
    assert.equal(res.success, false);
  });
});

describe("POST /remiry/items", () => {
  test("creates a remind item", async () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = await router.call("POST", "/remiry/items", {
      body: { type: "remind", name: "Meeting", target_date: "2026-04-10 09:00" },
    });
    assert.equal(res.success, true);
    assert.equal((res.data as { name: string }).name, "Meeting");
  });

  test("creates an expire item with bbf", async () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = await router.call("POST", "/remiry/items", {
      body: { type: "expire", name: "Milk", target_date: "2026-04-02", bbf: true },
    });
    assert.equal(res.success, true);
    assert.equal((res.data as { bbf: boolean }).bbf, true);
  });

  test("rejects missing name", async () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = await router.call("POST", "/remiry/items", {
      body: { type: "remind", target_date: "2026-04-10 09:00" },
    });
    assert.equal(res.success, false);
  });

  test("rejects invalid target_date format", async () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = await router.call("POST", "/remiry/items", {
      body: { type: "remind", name: "Test", target_date: "not-a-date" },
    });
    assert.equal(res.success, false);
  });

  test("rejects date-only target_date for remind type", async () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = await router.call("POST", "/remiry/items", {
      body: { type: "remind", name: "Test", target_date: "2026-04-10" },
    });
    assert.equal(res.success, false);
  });

  test("accepts datetime target_date for remind type", async () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = await router.call("POST", "/remiry/items", {
      body: { type: "remind", name: "Test", target_date: "2026-04-10 14:30" },
    });
    assert.equal(res.success, true);
  });

  test("rejects invalid type", async () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = await router.call("POST", "/remiry/items", {
      body: { type: "wrong", name: "Test", target_date: "2026-04-10" },
    });
    assert.equal(res.success, false);
  });

  test("accepts base64 image and returns file path", async () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const imageB64 = Buffer.from("fake-image").toString("base64");
    const res = await router.call("POST", "/remiry/items", {
      body: { type: "expire", name: "Cheese", target_date: "2026-04-20", image: imageB64 },
    });
    assert.equal(res.success, true);
    assert.ok(typeof (res.data as { image: string }).image === "string");
  });
});

describe("PUT /remiry/items/:id", () => {
  test("updates item name", async () => {
    const db = initDb(":memory:");
    const item = db.create({ type: "remind", name: "Old", target_date: "2026-04-01 09:00" });
    const router = buildRouter(db);
    const res = await router.call("PUT", "/remiry/items/:id", {
      params: { id: String(item.id) },
      body: { name: "New" },
    });
    assert.equal(res.success, true);
    assert.equal((res.data as { name: string }).name, "New");
  });

  test("returns error for missing id", async () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = await router.call("PUT", "/remiry/items/:id", {
      params: { id: "9999" },
      body: { name: "x" },
    });
    assert.equal(res.success, false);
  });
});

describe("DELETE /remiry/items/:id", () => {
  test("deletes existing item", async () => {
    const db = initDb(":memory:");
    const item = db.create({ type: "remind", name: "Gone", target_date: "2026-04-01 09:00" });
    const router = buildRouter(db);
    const res = await router.call("DELETE", "/remiry/items/:id", { params: { id: String(item.id) } });
    assert.equal(res.success, true);
    assert.equal((res.data as { deleted: boolean }).deleted, true);
  });

  test("returns error for missing id", async () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = await router.call("DELETE", "/remiry/items/:id", { params: { id: "9999" } });
    assert.equal(res.success, false);
  });
});

describe("GET /remiry/upcoming/events", () => {
  test("returns upcoming remind items", async () => {
    const db = initDb(":memory:");
    const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    db.create({ type: "remind", name: "Soon", target_date: `${soon} 10:00` });
    const router = buildRouter(db);
    const res = await router.call("GET", "/remiry/upcoming/events");
    assert.equal(res.success, true);
    assert.equal((res.data as unknown[]).length, 1);
  });

  test("respects custom days param", async () => {
    const db = initDb(":memory:");
    const in20 = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    db.create({ type: "remind", name: "Later", target_date: `${in20} 10:00` });
    const router = buildRouter(db);
    const defaultRes = await router.call("GET", "/remiry/upcoming/events", { query: { days: "7" } });
    assert.equal((defaultRes.data as unknown[]).length, 0);
    const wideRes = await router.call("GET", "/remiry/upcoming/events", { query: { days: "30" } });
    assert.equal((wideRes.data as unknown[]).length, 1);
  });

  test("rejects negative days", async () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = await router.call("GET", "/remiry/upcoming/events", { query: { days: "-1" } });
    assert.equal(res.success, false);
  });
});

describe("GET /remiry/upcoming/expiry", () => {
  test("returns upcoming expire items", async () => {
    const db = initDb(":memory:");
    const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    db.create({ type: "expire", name: "Yogurt", target_date: soon });
    const router = buildRouter(db);
    const res = await router.call("GET", "/remiry/upcoming/expiry");
    assert.equal(res.success, true);
    assert.equal((res.data as unknown[]).length, 1);
  });
});

describe("DELETE /remiry/items (clear all)", () => {
  test("clears all items with confirm=true", async () => {
    const db = initDb(":memory:");
    db.create({ type: "remind", name: "A", target_date: "2026-04-01 09:00" });
    db.create({ type: "expire", name: "B", target_date: "2026-04-02" });
    const router = buildRouter(db);
    const res = await router.call("DELETE", "/remiry/items", { query: { confirm: "true" } });
    assert.equal(res.success, true);
    assert.equal((res.data as { deleted: number }).deleted, 2);
    assert.equal(db.getAll().length, 0);
  });

  test("rejects without confirm=true", async () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = await router.call("DELETE", "/remiry/items", {});
    assert.equal(res.success, false);
  });
});

describe("GET /remiry/summary", () => {
  test("returns on_date and upcoming sections", async () => {
    const db = initDb(":memory:");
    db.create({ type: "remind", name: "Morning",  target_date: "2026-04-15 09:00" });
    db.create({ type: "expire", name: "Milk",     target_date: "2026-04-15" });
    db.create({ type: "remind", name: "Next day", target_date: "2026-04-16 10:00" });
    db.create({ type: "expire", name: "Cheese",   target_date: "2026-04-18" });
    const router = buildRouter(db);
    const res = await router.call("GET", "/remiry/summary", { query: { date: "2026-04-15", upcoming_days: "7" } });
    assert.equal(res.success, true);
    const data = res.data as { on_date: { events: unknown[]; expiry: unknown[] }; upcoming: { events: unknown[]; expiry: unknown[] } };
    assert.equal(data.on_date.events.length, 1);
    assert.equal(data.on_date.expiry.length, 1);
    assert.equal(data.upcoming.events.length, 1);
    assert.equal(data.upcoming.expiry.length, 1);
  });

  test("defaults to today when date omitted", async () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = await router.call("GET", "/remiry/summary");
    assert.equal(res.success, true);
    const data = res.data as { date: string };
    assert.equal(data.date, new Date().toISOString().slice(0, 10));
  });

  test("rejects invalid date format", async () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = await router.call("GET", "/remiry/summary", { query: { date: "not-a-date" } });
    assert.equal(res.success, false);
  });

  test("rejects negative upcoming_days", async () => {
    const db = initDb(":memory:");
    const router = buildRouter(db);
    const res = await router.call("GET", "/remiry/summary", { query: { date: "2026-04-15", upcoming_days: "-1" } });
    assert.equal(res.success, false);
  });
});
