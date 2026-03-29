import type { RemiryDb, ItemType, CreateItemInput, UpdateItemInput } from "./db.js";

type PluginApi = {
  registerHttpRoute(
    method: string,
    path: string,
    handler: (req: HttpRequest) => HttpResponse | Promise<HttpResponse>
  ): void;
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

function parseImage(imageB64: string | undefined): Buffer | undefined {
  if (!imageB64) return undefined;
  return Buffer.from(imageB64, "base64");
}

function serializeItem(item: ReturnType<RemiryDb["getById"]>) {
  if (!item) return null;
  return {
    ...item,
    bbf: item.bbf === 1,
    image: item.image ? item.image.toString("base64") : null,
  };
}

export function registerRoutes(api: PluginApi, db: RemiryDb): void {
  // GET /remiry/items?type=remind|expire
  api.registerHttpRoute("GET", "/remiry/items", (req) => {
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
  });

  // GET /remiry/items/:id
  api.registerHttpRoute("GET", "/remiry/items/:id", (req) => {
    try {
      const id = Number(req.params?.id);
      if (!Number.isInteger(id) || id <= 0) return badRequest("Invalid id");
      const item = db.getById(id);
      if (!item) return notFound(`Item ${id} not found`);
      return ok(serializeItem(item));
    } catch (err) {
      return serverError(err);
    }
  });

  // POST /remiry/items
  api.registerHttpRoute("POST", "/remiry/items", (req) => {
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
      if (typeof target_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(target_date)) {
        return badRequest("target_date is required in YYYY-MM-DD format");
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
  });

  // PUT /remiry/items/:id
  api.registerHttpRoute("PUT", "/remiry/items/:id", (req) => {
    try {
      const id = Number(req.params?.id);
      if (!Number.isInteger(id) || id <= 0) return badRequest("Invalid id");

      const body = req.body as Record<string, unknown> | undefined;
      if (!body) return badRequest("Request body is required");

      const { type, name, desc, image, bbf, active_date, target_date } = body;

      if (type !== undefined && type !== "remind" && type !== "expire") {
        return badRequest("type must be 'remind' or 'expire'");
      }
      if (target_date !== undefined && (typeof target_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(target_date))) {
        return badRequest("target_date must be in YYYY-MM-DD format");
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
  });

  // DELETE /remiry/items/:id
  api.registerHttpRoute("DELETE", "/remiry/items/:id", (req) => {
    try {
      const id = Number(req.params?.id);
      if (!Number.isInteger(id) || id <= 0) return badRequest("Invalid id");
      const deleted = db.remove(id);
      if (!deleted) return notFound(`Item ${id} not found`);
      return ok({ id, deleted: true });
    } catch (err) {
      return serverError(err);
    }
  });

  // GET /remiry/upcoming/events?days=7
  api.registerHttpRoute("GET", "/remiry/upcoming/events", (req) => {
    try {
      const days = Number(req.query?.days ?? "7");
      if (!Number.isInteger(days) || days < 0) return badRequest("days must be a non-negative integer");
      const items = db.upcomingEvents(days).map(serializeItem);
      return ok(items);
    } catch (err) {
      return serverError(err);
    }
  });

  // GET /remiry/upcoming/expiry?days=7
  api.registerHttpRoute("GET", "/remiry/upcoming/expiry", (req) => {
    try {
      const days = Number(req.query?.days ?? "7");
      if (!Number.isInteger(days) || days < 0) return badRequest("days must be a non-negative integer");
      const items = db.upcomingExpiry(days).map(serializeItem);
      return ok(items);
    } catch (err) {
      return serverError(err);
    }
  });
}
