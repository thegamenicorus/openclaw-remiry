import type { RemiryDb, ItemType, CreateItemInput, UpdateItemInput } from "./db.js";

type PluginApi = {
  registerHttpRoute(opts: {
    method: string;
    path: string;
    handler: (req: HttpRequest) => HttpResponse | Promise<HttpResponse>;
  }): void;
};

interface HttpRequest {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
}

interface HttpResponse {
  status: number;
  body: unknown;
}

function ok(data: unknown): HttpResponse {
  return { status: 200, body: { success: true, data } };
}

function created(data: unknown): HttpResponse {
  return { status: 201, body: { success: true, data } };
}

function notFound(msg: string): HttpResponse {
  return { status: 404, body: { success: false, error: msg } };
}

function badRequest(msg: string): HttpResponse {
  return { status: 400, body: { success: false, error: msg } };
}

function serverError(err: unknown): HttpResponse {
  return { status: 500, body: { success: false, error: String(err) } };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME  = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

function isValidTargetDate(type: "remind" | "expire", value: string): boolean {
  return type === "remind" ? DATETIME.test(value) : DATE_ONLY.test(value);
}

function parseImage(imageB64: string | undefined): Buffer | undefined {
  if (!imageB64) return undefined;
  return Buffer.from(imageB64, "base64");
}

function serializeItem(item: ReturnType<RemiryDb["getById"]>) {
  if (!item) return null;
  return {
    ...item,
    bbf: item.bbf === 1,
    // image is already a file path string (or null) — return as-is
  };
}

export function registerRoutes(api: PluginApi, db: RemiryDb): void {
  // GET /remiry/items?type=remind|expire
  api.registerHttpRoute({ method: "GET", path: "/remiry/items", handler: (req) => {
    try {
      const type = req.query?.type as ItemType | undefined;
      if (type && type !== "remind" && type !== "expire") {
        return badRequest("type must be 'remind' or 'expire'");
      }
      const items = db.getAll(type).map(serializeItem);
      return ok(items);
    } catch (err) {
      return serverError(err);
    }
  }});

  // GET /remiry/items/:id
  api.registerHttpRoute({ method: "GET", path: "/remiry/items/:id", handler: (req) => {
    try {
      const id = Number(req.params?.id);
      if (!Number.isInteger(id) || id <= 0) return badRequest("Invalid id");
      const item = db.getById(id);
      if (!item) return notFound(`Item ${id} not found`);
      return ok(serializeItem(item));
    } catch (err) {
      return serverError(err);
    }
  }});

  // POST /remiry/items
  api.registerHttpRoute({ method: "POST", path: "/remiry/items", handler: (req) => {
    try {
      const body = req.body as Record<string, unknown> | undefined;
      if (!body) return badRequest("Request body is required");

      const { type, name, desc, image, bbf, active_date, target_date } = body;

      if (type !== "remind" && type !== "expire") {
        return badRequest("type must be 'remind' or 'expire'");
      }
      if (typeof name !== "string" || !name.trim()) {
        return badRequest("name is required");
      }
      if (typeof target_date !== "string" || !isValidTargetDate(type, target_date)) {
        return badRequest(
          type === "remind"
            ? "target_date is required in YYYY-MM-DD HH:MM format for events"
            : "target_date is required in YYYY-MM-DD format for expiry items"
        );
      }

      const input: CreateItemInput = {
        type,
        name: name.trim(),
        target_date,
        desc: typeof desc === "string" ? desc : undefined,
        image: typeof image === "string" ? parseImage(image) : undefined,
        bbf: typeof bbf === "boolean" ? bbf : bbf === 1,
        active_date: typeof active_date === "string" ? active_date : undefined,
      };

      const item = db.create(input);
      return created(serializeItem(item));
    } catch (err) {
      return serverError(err);
    }
  }});

  // PUT /remiry/items/:id
  api.registerHttpRoute({ method: "PUT", path: "/remiry/items/:id", handler: (req) => {
    try {
      const id = Number(req.params?.id);
      if (!Number.isInteger(id) || id <= 0) return badRequest("Invalid id");

      const body = req.body as Record<string, unknown> | undefined;
      if (!body) return badRequest("Request body is required");

      const { type, name, desc, image, bbf, active_date, target_date } = body;

      if (type !== undefined && type !== "remind" && type !== "expire") {
        return badRequest("type must be 'remind' or 'expire'");
      }
      if (target_date !== undefined) {
        const existing = db.getById(id);
        if (!existing) return notFound(`Item ${id} not found`);
        const effectiveType = (type as ItemType | undefined) ?? existing.type;
        if (typeof target_date !== "string" || !isValidTargetDate(effectiveType, target_date)) {
          return badRequest(
            effectiveType === "remind"
              ? "target_date must be in YYYY-MM-DD HH:MM format for events"
              : "target_date must be in YYYY-MM-DD format for expiry items"
          );
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
      if (!updated) return notFound(`Item ${id} not found`);
      return ok(serializeItem(updated));
    } catch (err) {
      return serverError(err);
    }
  }});

  // DELETE /remiry/items  (clear all — requires ?confirm=true)
  api.registerHttpRoute({ method: "DELETE", path: "/remiry/items", handler: (req) => {
    try {
      if (req.query?.confirm !== "true") {
        return badRequest("Pass ?confirm=true to clear all items");
      }
      const result = db.clearAll();
      return ok({ ...result, message: "All items cleared" });
    } catch (err) {
      return serverError(err);
    }
  }});

  // DELETE /remiry/items/:id
  api.registerHttpRoute({ method: "DELETE", path: "/remiry/items/:id", handler: (req) => {
    try {
      const id = Number(req.params?.id);
      if (!Number.isInteger(id) || id <= 0) return badRequest("Invalid id");
      const deleted = db.remove(id);
      if (!deleted) return notFound(`Item ${id} not found`);
      return ok({ id, deleted: true });
    } catch (err) {
      return serverError(err);
    }
  }});

  // GET /remiry/upcoming/events?days=7
  api.registerHttpRoute({ method: "GET", path: "/remiry/upcoming/events", handler: (req) => {
    try {
      const days = Number(req.query?.days ?? "7");
      if (!Number.isInteger(days) || days < 0) return badRequest("days must be a non-negative integer");
      const items = db.upcomingEvents(days).map(serializeItem);
      return ok(items);
    } catch (err) {
      return serverError(err);
    }
  }});

  // GET /remiry/summary?date=YYYY-MM-DD&upcoming_days=7
  api.registerHttpRoute({ method: "GET", path: "/remiry/summary", handler: (req) => {
    try {
      const date = req.query?.date ?? new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return badRequest("date must be in YYYY-MM-DD format");
      }
      const upcomingDays = Number(req.query?.upcoming_days ?? "7");
      if (!Number.isInteger(upcomingDays) || upcomingDays < 0) {
        return badRequest("upcoming_days must be a non-negative integer");
      }
      const result = db.summary(date, upcomingDays);
      const serialize = (item: ReturnType<RemiryDb["getById"]>) => serializeItem(item);
      return ok({
        date: result.date,
        upcoming_days: result.upcoming_days,
        on_date: {
          events: result.on_date.events.map(serialize),
          expiry: result.on_date.expiry.map(serialize),
        },
        upcoming: {
          events: result.upcoming.events.map(serialize),
          expiry: result.upcoming.expiry.map(serialize),
        },
      });
    } catch (err) {
      return serverError(err);
    }
  }});

  // GET /remiry/upcoming/expiry?days=7
  api.registerHttpRoute({ method: "GET", path: "/remiry/upcoming/expiry", handler: (req) => {
    try {
      const days = Number(req.query?.days ?? "7");
      if (!Number.isInteger(days) || days < 0) return badRequest("days must be a non-negative integer");
      const items = db.upcomingExpiry(days).map(serializeItem);
      return ok(items);
    } catch (err) {
      return serverError(err);
    }
  }});
}
