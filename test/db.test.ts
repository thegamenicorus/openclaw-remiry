import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initDb } from "../src/db.js";
import type { RemiryDb } from "../src/db.js";

function freshDb(): RemiryDb {
  return initDb(":memory:");
}

describe("db.create", () => {
  test("creates a remind item with required fields", () => {
    const db = freshDb();
    const item = db.create({ type: "remind", name: "Dentist", target_date: "2026-04-15" });
    assert.equal(item.type, "remind");
    assert.equal(item.name, "Dentist");
    assert.equal(item.target_date, "2026-04-15");
    assert.equal(item.bbf, 0);
    assert.equal(item.desc, null);
    assert.equal(item.image, null);
  });

  test("creates an expire item with bbf=true", () => {
    const db = freshDb();
    const item = db.create({ type: "expire", name: "Milk", target_date: "2026-04-02", bbf: true });
    assert.equal(item.type, "expire");
    assert.equal(item.bbf, 1);
  });

  test("assigns incrementing ids", () => {
    const db = freshDb();
    const a = db.create({ type: "remind", name: "A", target_date: "2026-05-01" });
    const b = db.create({ type: "remind", name: "B", target_date: "2026-05-02" });
    assert.ok(b.id > a.id);
  });

  test("stores optional desc", () => {
    const db = freshDb();
    const item = db.create({ type: "remind", name: "Meeting", target_date: "2026-04-10", desc: "Weekly sync" });
    assert.equal(item.desc, "Weekly sync");
  });

  test("stores image and returns file path", () => {
    const db = freshDb();
    const img = Buffer.from("fake-image-data");
    const item = db.create({ type: "expire", name: "Cheese", target_date: "2026-04-20", image: img });
    assert.ok(typeof item.image === "string");
    assert.ok(item.image.endsWith(".bin")); // detected as unknown → .bin
  });
});

describe("db.getAll", () => {
  test("returns all items ordered by target_date asc", () => {
    const db = freshDb();
    db.create({ type: "remind", name: "Z", target_date: "2026-06-01" });
    db.create({ type: "remind", name: "A", target_date: "2026-04-01" });
    const items = db.getAll();
    assert.equal(items.length, 2);
    assert.equal(items[0].name, "A");
    assert.equal(items[1].name, "Z");
  });

  test("filters by type", () => {
    const db = freshDb();
    db.create({ type: "remind", name: "Event", target_date: "2026-04-01" });
    db.create({ type: "expire", name: "Food", target_date: "2026-04-02" });
    const reminders = db.getAll("remind");
    assert.equal(reminders.length, 1);
    assert.equal(reminders[0].name, "Event");
  });

  test("returns empty array when no items", () => {
    const db = freshDb();
    assert.deepEqual(db.getAll(), []);
  });
});

describe("db.getById", () => {
  test("returns item by id", () => {
    const db = freshDb();
    const created = db.create({ type: "remind", name: "Test", target_date: "2026-04-01" });
    const found = db.getById(created.id);
    assert.ok(found);
    assert.equal(found.name, "Test");
  });

  test("returns undefined for missing id", () => {
    const db = freshDb();
    assert.equal(db.getById(9999), undefined);
  });
});

describe("db.update", () => {
  test("updates name and target_date", () => {
    const db = freshDb();
    const item = db.create({ type: "remind", name: "Old", target_date: "2026-04-01" });
    const updated = db.update(item.id, { name: "New", target_date: "2026-05-01" });
    assert.ok(updated);
    assert.equal(updated.name, "New");
    assert.equal(updated.target_date, "2026-05-01");
  });

  test("updates bbf flag", () => {
    const db = freshDb();
    const item = db.create({ type: "expire", name: "Milk", target_date: "2026-04-02" });
    assert.equal(item.bbf, 0);
    const updated = db.update(item.id, { bbf: true });
    assert.ok(updated);
    assert.equal(updated.bbf, 1);
  });

  test("clears desc when set to null", () => {
    const db = freshDb();
    const item = db.create({ type: "remind", name: "Test", target_date: "2026-04-01", desc: "Some desc" });
    const updated = db.update(item.id, { desc: null });
    assert.ok(updated);
    assert.equal(updated.desc, null);
  });

  test("returns undefined for missing id", () => {
    const db = freshDb();
    assert.equal(db.update(9999, { name: "x" }), undefined);
  });

  test("does not change unmentioned fields", () => {
    const db = freshDb();
    const item = db.create({ type: "remind", name: "Stable", target_date: "2026-04-01", desc: "Keep me" });
    const updated = db.update(item.id, { name: "Changed" });
    assert.ok(updated);
    assert.equal(updated.desc, "Keep me");
    assert.equal(updated.target_date, "2026-04-01");
  });
});

describe("db.remove", () => {
  test("deletes existing item and returns true", () => {
    const db = freshDb();
    const item = db.create({ type: "remind", name: "Delete me", target_date: "2026-04-01" });
    assert.equal(db.remove(item.id), true);
    assert.equal(db.getById(item.id), undefined);
  });

  test("returns false for missing id", () => {
    const db = freshDb();
    assert.equal(db.remove(9999), false);
  });
});

describe("db.upcomingEvents", () => {
  test("returns remind items within the date window", () => {
    const db = freshDb();
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const far = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    db.create({ type: "remind", name: "Soon", target_date: soon });
    db.create({ type: "remind", name: "Far", target_date: far });
    db.create({ type: "expire", name: "Not remind", target_date: soon });

    const upcoming = db.upcomingEvents(7);
    assert.equal(upcoming.length, 1);
    assert.equal(upcoming[0].name, "Soon");
  });

  test("excludes past items", () => {
    const db = freshDb();
    const past = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    db.create({ type: "remind", name: "Past event", target_date: past });
    assert.equal(db.upcomingEvents(7).length, 0);
  });
});

describe("db.upcomingExpiry", () => {
  test("returns expire items within the date window including bbf", () => {
    const db = freshDb();
    const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const far = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    db.create({ type: "expire", name: "Hard expiry", target_date: soon, bbf: false });
    db.create({ type: "expire", name: "BBF item", target_date: soon, bbf: true });
    db.create({ type: "expire", name: "Far expiry", target_date: far });
    db.create({ type: "remind", name: "Not expire", target_date: soon });

    const upcoming = db.upcomingExpiry(7);
    assert.equal(upcoming.length, 2);
    const names = upcoming.map((i) => i.name);
    assert.ok(names.includes("Hard expiry"));
    assert.ok(names.includes("BBF item"));
  });
});

describe("db.summary", () => {
  test("on_date contains events and expiry exactly on that date", () => {
    const db = freshDb();
    const target = "2026-04-15";
    db.create({ type: "remind", name: "Morning meeting", target_date: "2026-04-15 09:00" });
    db.create({ type: "remind", name: "Evening call",   target_date: "2026-04-15 18:00" });
    db.create({ type: "expire", name: "Milk",           target_date: "2026-04-15" });
    db.create({ type: "remind", name: "Next week",      target_date: "2026-04-20 10:00" });
    db.create({ type: "expire", name: "Cheese",         target_date: "2026-04-18" });

    const result = db.summary(target, 7);
    assert.equal(result.on_date.events.length, 2);
    assert.equal(result.on_date.expiry.length, 1);
    assert.equal(result.on_date.expiry[0].name, "Milk");
  });

  test("upcoming contains items strictly after date within window", () => {
    const db = freshDb();
    const target = "2026-04-15";
    db.create({ type: "remind", name: "On target day",  target_date: "2026-04-15 09:00" });
    db.create({ type: "remind", name: "Day after",      target_date: "2026-04-16 10:00" });
    db.create({ type: "expire", name: "Cheese",         target_date: "2026-04-18" });
    db.create({ type: "expire", name: "Far away",       target_date: "2026-05-01" });

    const result = db.summary(target, 7);
    // on_date does NOT appear in upcoming
    assert.equal(result.upcoming.events.length, 1);
    assert.equal(result.upcoming.events[0].name, "Day after");
    // upcoming expiry within 7 days of 2026-04-15 → up to 2026-04-22
    assert.equal(result.upcoming.expiry.length, 1);
    assert.equal(result.upcoming.expiry[0].name, "Cheese");
  });

  test("returns date and upcoming_days in result", () => {
    const db = freshDb();
    const result = db.summary("2026-04-15", 14);
    assert.equal(result.date, "2026-04-15");
    assert.equal(result.upcoming_days, 14);
  });

  test("empty result when no items", () => {
    const db = freshDb();
    const result = db.summary("2026-04-15", 7);
    assert.equal(result.on_date.events.length, 0);
    assert.equal(result.on_date.expiry.length, 0);
    assert.equal(result.upcoming.events.length, 0);
    assert.equal(result.upcoming.expiry.length, 0);
  });
});
