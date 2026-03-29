import { Type } from "@sinclair/typebox";
import type { RemiryDb, CreateItemInput, UpdateItemInput, ItemType } from "./db.js";

type ToolApi = {
  registerTool(tool: {
    name: string;
    description: string;
    optional?: boolean;
    parameters: unknown;
    execute(id: string, params: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }>;
  }): void;
};

function textResult(data: unknown): { content: Array<{ type: string; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function serializeItem(item: ReturnType<RemiryDb["getById"]>) {
  if (!item) return null;
  return {
    ...item,
    bbf: item.bbf === 1,
    image: item.image ? `<binary blob ${item.image.length} bytes>` : null,
  };
}

export function registerTools(api: ToolApi, db: RemiryDb): void {
  // List items
  api.registerTool({
    name: "remiry_list_items",
    description: "List all reminder/expiry items. Optionally filter by type ('remind' or 'expire') and/or bbf flag.",
    optional: true,
    parameters: Type.Object({
      type: Type.Optional(Type.Union([Type.Literal("remind"), Type.Literal("expire")], {
        description: "Filter by item type: 'remind' for events, 'expire' for expiry/best-before items",
      })),
      bbf_only: Type.Optional(Type.Boolean({
        description: "If true, return only best-before (bbf=true) items within expire type",
      })),
    }),
    async execute(_id, params) {
      const type = params.type as ItemType | undefined;
      let items = db.getAll(type);
      if (params.bbf_only === true) {
        items = items.filter((i) => i.bbf === 1);
      }
      return textResult({ count: items.length, items: items.map(serializeItem) });
    },
  });

  // Get single item
  api.registerTool({
    name: "remiry_get_item",
    description: "Get a single reminder/expiry item by its numeric ID.",
    optional: true,
    parameters: Type.Object({
      id: Type.Number({ description: "The item ID" }),
    }),
    async execute(_id, params) {
      const item = db.getById(Number(params.id));
      if (!item) return textResult({ error: `Item ${params.id} not found` });
      return textResult(serializeItem(item));
    },
  });

  // Create item
  api.registerTool({
    name: "remiry_create_item",
    description:
      "Create a new reminder or expiry/best-before item. " +
      "Use type='remind' for upcoming events (target_date = event date). " +
      "Use type='expire' for items that expire; set bbf=true to mark as best-before instead of hard expiry.",
    optional: true,
    parameters: Type.Object({
      type: Type.Union([Type.Literal("remind"), Type.Literal("expire")], {
        description: "'remind' for event reminders, 'expire' for expiry/best-before items",
      }),
      name: Type.String({ description: "Name of the event or item" }),
      target_date: Type.String({ description: "Target date in YYYY-MM-DD format" }),
      desc: Type.Optional(Type.String({ description: "Optional description" })),
      bbf: Type.Optional(Type.Boolean({
        description: "Set to true for best-before (only meaningful for type='expire')",
      })),
      active_date: Type.Optional(Type.String({
        description: "Date when this item becomes active (YYYY-MM-DD, defaults to today)",
      })),
    }),
    async execute(_id, params) {
      const input: CreateItemInput = {
        type: params.type as ItemType,
        name: String(params.name),
        target_date: String(params.target_date),
        desc: params.desc as string | undefined,
        bbf: params.bbf as boolean | undefined,
        active_date: params.active_date as string | undefined,
      };
      const item = db.create(input);
      return textResult({ created: true, item: serializeItem(item) });
    },
  });

  // Update item
  api.registerTool({
    name: "remiry_update_item",
    description: "Update one or more fields of an existing reminder/expiry item by ID.",
    optional: true,
    parameters: Type.Object({
      id: Type.Number({ description: "The item ID to update" }),
      type: Type.Optional(Type.Union([Type.Literal("remind"), Type.Literal("expire")])),
      name: Type.Optional(Type.String()),
      target_date: Type.Optional(Type.String({ description: "New target date in YYYY-MM-DD format" })),
      desc: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "New description or null to clear" })),
      bbf: Type.Optional(Type.Boolean()),
      active_date: Type.Optional(Type.String({ description: "New active date in YYYY-MM-DD format" })),
    }),
    async execute(_id, params) {
      const input: UpdateItemInput = {};
      if (params.type !== undefined) input.type = params.type as ItemType;
      if (params.name !== undefined) input.name = String(params.name);
      if (params.target_date !== undefined) input.target_date = String(params.target_date);
      if ("desc" in params) input.desc = params.desc !== null ? String(params.desc) : null;
      if (params.bbf !== undefined) input.bbf = Boolean(params.bbf);
      if (params.active_date !== undefined) input.active_date = String(params.active_date);

      const updated = db.update(Number(params.id), input);
      if (!updated) return textResult({ error: `Item ${params.id} not found` });
      return textResult({ updated: true, item: serializeItem(updated) });
    },
  });

  // Delete item
  api.registerTool({
    name: "remiry_delete_item",
    description: "Permanently delete a reminder/expiry item by ID.",
    optional: true,
    parameters: Type.Object({
      id: Type.Number({ description: "The item ID to delete" }),
    }),
    async execute(_id, params) {
      const deleted = db.remove(Number(params.id));
      if (!deleted) return textResult({ error: `Item ${params.id} not found` });
      return textResult({ deleted: true, id: params.id });
    },
  });

  // Upcoming events
  api.registerTool({
    name: "remiry_upcoming_events",
    description:
      "Get upcoming event reminders (type='remind') whose target date falls within the next N days from today.",
    optional: true,
    parameters: Type.Object({
      days: Type.Optional(Type.Number({
        description: "Number of days to look ahead (default: 7)",
      })),
    }),
    async execute(_id, params) {
      const days = typeof params.days === "number" ? params.days : 7;
      const items = db.upcomingEvents(days);
      return textResult({
        days,
        count: items.length,
        items: items.map(serializeItem),
      });
    },
  });

  // Upcoming expiry
  api.registerTool({
    name: "remiry_upcoming_expiry",
    description:
      "Get items (type='expire') that are expiring or reaching their best-before date within the next N days from today.",
    optional: true,
    parameters: Type.Object({
      days: Type.Optional(Type.Number({
        description: "Number of days to look ahead (default: 7)",
      })),
      bbf_only: Type.Optional(Type.Boolean({
        description: "If true, return only best-before items; if false, only hard-expiry; omit for both",
      })),
    }),
    async execute(_id, params) {
      const days = typeof params.days === "number" ? params.days : 7;
      let items = db.upcomingExpiry(days);
      if (params.bbf_only === true) {
        items = items.filter((i) => i.bbf === 1);
      } else if (params.bbf_only === false) {
        items = items.filter((i) => i.bbf === 0);
      }
      return textResult({
        days,
        count: items.length,
        items: items.map(serializeItem),
      });
    },
  });
}
