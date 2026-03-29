import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { initDb } from "./src/db.js";
import { registerRoutes } from "./src/routes.js";
import { registerTools } from "./src/tools.js";

export default definePluginEntry({
  id: "remiry",
  name: "OpenClaw Remiry",
  description: "Track reminders for upcoming events and expiry/best-before dates for items",

  register(api, config) {
    const dbPath = (config as Record<string, unknown>)?.dbPath as string | undefined;
    const db = initDb(dbPath);

    registerRoutes(api as Parameters<typeof registerRoutes>[0], db);
    registerTools(api as Parameters<typeof registerTools>[0], db);
  },
});
