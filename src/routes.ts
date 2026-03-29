import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import type { RemiryDb, ItemType, CreateItemInput, UpdateItemInput } from "./db.js";

type Req = IncomingMessage & { params?: Record<string, string> };
type Res = ServerResponse & { json?: (body: unknown) => void };

type PluginApi = {
  registerHttpRoute(opts: {
    path: string;
    auth: "gateway" | "plugin";
    handler: (req: Req, res: Res) => void;
  }): void;
};

// ── Response helpers ──────────────────────────────────────────────────────────

function send(res: Res, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  if (typeof res.json === "function") {
    res.statusCode = status;
    res.json(body);
  } else {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(json);
  }
}

function ok(res: Res, data: unknown)          { send(res, 200, { success: true, data }); }
function created(res: Res, data: unknown)     { send(res, 201, { success: true, data }); }
function notFound(res: Res, msg: string)      { send(res, 404, { success: false, error: msg }); }
function badRequest(res: Res, msg: string)    { send(res, 400, { success: false, error: msg }); }
function methodNotAllowed(res: Res)           { send(res, 405, { success: false, error: "Method not allowed" }); }
function serverError(res: Res, err: unknown)  { send(res, 500, { success: false, error: String(err) }); }

// ── Request helpers ───────────────────────────────────────────────────────────

function query(req: Req): Record<string, string> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const q: Record<string, string> = {};
    url.searchParams.forEach((v, k) => { q[k] = v; });
    return q;
  } catch { return {}; }
}

function readBody(req: Req): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      if (!raw) { resolve(undefined); return; }
      try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
    });
  });
}

// ── Serializer ────────────────────────────────────────────────────────────────

function serializeItem(item: ReturnType<RemiryDb["getById"]>) {
  if (!item) return null;
  return { ...item, bbf: item.bbf === 1 };
}

// ── Validation ────────────────────────────────────────────────────────────────

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME  = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

function isValidTargetDate(type: "remind" | "expire", value: string): boolean {
  return type === "remind" ? DATETIME.test(value) : DATE_ONLY.test(value);
}

function parseImage(imageB64: string | undefined): Buffer | undefined {
  if (!imageB64) return undefined;
  return Buffer.from(imageB64, "base64");
}

// ── Routes ────────────────────────────────────────────────────────────────────

export function registerRoutes(api: PluginApi, db: RemiryDb): void {
  // /remiry/health
  api.registerHttpRoute({ path: "/remiry/health", auth: "plugin", handler: (_req, res) => {
    try {
      ok(res, { status: "ok", items: db.getAll().length });
    } catch (err) {
      serverError(res, err);
    }
  }});

  // /remiry/items  — GET list, POST create, DELETE clear all
  api.registerHttpRoute({ path: "/remiry/items", auth: "plugin", handler: async (req, res) => {
    const method = (req.method ?? "GET").toUpperCase();
    const q = query(req);
    try {
      if (method === "GET") {
        const type = q.type as ItemType | undefined;
        if (type && type !== "remind" && type !== "expire") {
          return badRequest(res, "type must be 'remind' or 'expire'");
        }
        return ok(res, db.getAll(type).map(serializeItem));
      }

      if (method === "POST") {
        const body = await readBody(req) as Record<string, unknown> | undefined;
        if (!body) return badRequest(res, "Request body is required");
        const { type, name, desc, image, bbf, active_date, target_date } = body;
        if (type !== "remind" && type !== "expire") return badRequest(res, "type must be 'remind' or 'expire'");
        if (typeof name !== "string" || !name.trim()) return badRequest(res, "name is required");
        if (typeof target_date !== "string" || !isValidTargetDate(type, target_date)) {
          return badRequest(res, type === "remind"
            ? "target_date is required in YYYY-MM-DD HH:MM format for events"
            : "target_date is required in YYYY-MM-DD format for expiry items");
        }
        const input: CreateItemInput = {
          type, name: name.trim(), target_date,
          desc: typeof desc === "string" ? desc : undefined,
          image: typeof image === "string" ? parseImage(image) : undefined,
          bbf: typeof bbf === "boolean" ? bbf : bbf === 1,
          active_date: typeof active_date === "string" ? active_date : undefined,
        };
        return created(res, serializeItem(db.create(input)));
      }

      if (method === "DELETE") {
        if (q.confirm !== "true") return badRequest(res, "Pass ?confirm=true to clear all items");
        return ok(res, { ...db.clearAll(), message: "All items cleared" });
      }

      methodNotAllowed(res);
    } catch (err) {
      serverError(res, err);
    }
  }});

  // /remiry/items/:id  — GET, PUT, DELETE
  api.registerHttpRoute({ path: "/remiry/items/:id", auth: "plugin", handler: async (req, res) => {
    const method = (req.method ?? "GET").toUpperCase();
    try {
      const id = Number(req.params?.id);
      if (!Number.isInteger(id) || id <= 0) return badRequest(res, "Invalid id");

      if (method === "GET") {
        const item = db.getById(id);
        if (!item) return notFound(res, `Item ${id} not found`);
        return ok(res, serializeItem(item));
      }

      if (method === "PUT") {
        const body = await readBody(req) as Record<string, unknown> | undefined;
        if (!body) return badRequest(res, "Request body is required");
        const { type, name, desc, image, bbf, active_date, target_date } = body;
        if (type !== undefined && type !== "remind" && type !== "expire") {
          return badRequest(res, "type must be 'remind' or 'expire'");
        }
        if (target_date !== undefined) {
          const existing = db.getById(id);
          if (!existing) return notFound(res, `Item ${id} not found`);
          const effectiveType = (type as ItemType | undefined) ?? existing.type;
          if (typeof target_date !== "string" || !isValidTargetDate(effectiveType, target_date)) {
            return badRequest(res, effectiveType === "remind"
              ? "target_date must be in YYYY-MM-DD HH:MM format for events"
              : "target_date must be in YYYY-MM-DD format for expiry items");
          }
        }
        const input: UpdateItemInput = {};
        if (type !== undefined) input.type = type as ItemType;
        if (name !== undefined) input.name = String(name).trim();
        if ("desc" in body) input.desc = desc !== null ? String(desc) : null;
        if ("image" in body) input.image = typeof image === "string" ? parseImage(image) : null;
        if (bbf !== undefined) input.bbf = Boolean(bbf);
        if (active_date !== undefined) input.active_date = String(active_date);
        if (target_date !== undefined) input.target_date = String(target_date);
        const updated = db.update(id, input);
        if (!updated) return notFound(res, `Item ${id} not found`);
        return ok(res, serializeItem(updated));
      }

      if (method === "DELETE") {
        const deleted = db.remove(id);
        if (!deleted) return notFound(res, `Item ${id} not found`);
        return ok(res, { id, deleted: true });
      }

      methodNotAllowed(res);
    } catch (err) {
      serverError(res, err);
    }
  }});

  // /remiry/summary
  api.registerHttpRoute({ path: "/remiry/summary", auth: "plugin", handler: (req, res) => {
    const q = query(req);
    try {
      const date = q.date ?? new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest(res, "date must be in YYYY-MM-DD format");
      const upcomingDays = Number(q.upcoming_days ?? "7");
      if (!Number.isInteger(upcomingDays) || upcomingDays < 0) return badRequest(res, "upcoming_days must be a non-negative integer");
      const result = db.summary(date, upcomingDays);
      ok(res, {
        date: result.date,
        upcoming_days: result.upcoming_days,
        on_date: {
          events: result.on_date.events.map(serializeItem),
          expiry: result.on_date.expiry.map(serializeItem),
        },
        upcoming: {
          events: result.upcoming.events.map(serializeItem),
          expiry: result.upcoming.expiry.map(serializeItem),
        },
      });
    } catch (err) {
      serverError(res, err);
    }
  }});

  // /remiry/upcoming/events
  api.registerHttpRoute({ path: "/remiry/upcoming/events", auth: "plugin", handler: (req, res) => {
    const q = query(req);
    try {
      const days = Number(q.days ?? "7");
      if (!Number.isInteger(days) || days < 0) return badRequest(res, "days must be a non-negative integer");
      ok(res, db.upcomingEvents(days).map(serializeItem));
    } catch (err) {
      serverError(res, err);
    }
  }});

  // /remiry/upcoming/expiry
  api.registerHttpRoute({ path: "/remiry/upcoming/expiry", auth: "plugin", handler: (req, res) => {
    const q = query(req);
    try {
      const days = Number(q.days ?? "7");
      if (!Number.isInteger(days) || days < 0) return badRequest(res, "days must be a non-negative integer");
      ok(res, db.upcomingExpiry(days).map(serializeItem));
    } catch (err) {
      serverError(res, err);
    }
  }});
}
