/**
 * Standalone dev server for manually testing Remiry HTTP routes.
 * Mimics the OpenClaw route-calling convention so behaviour matches production.
 *
 * Usage:
 *   node --import tsx/esm dev-server.ts
 *   node --import tsx/esm dev-server.ts --port 4000
 */

import http from "node:http";
import { URL } from "node:url";
import { initDb } from "./src/db.js";
import { registerRoutes } from "./src/routes.js";

const PORT = (() => {
  const i = process.argv.indexOf("--port");
  return i !== -1 ? Number(process.argv[i + 1]) : 3000;
})();

// ── Route registry ────────────────────────────────────────────────────────────

import type { IncomingMessage, ServerResponse } from "node:http";
type Handler = (req: IncomingMessage & { params?: Record<string, string> }, res: ServerResponse) => void | Promise<void>;

const routes: Array<{ pattern: string; handler: Handler }> = [];

const api = {
  registerHttpRoute(opts: { path: string; auth: string; handler: Handler }) {
    routes.push({ pattern: opts.path, handler: opts.handler });
    console.log(`  registered  ${opts.path}`);
  },
};

// ── Init ──────────────────────────────────────────────────────────────────────

const db = initDb(new URL("./dev.db", import.meta.url).pathname);
registerRoutes(api, db);

// ── Route matcher ─────────────────────────────────────────────────────────────

function matchRoute(pathname: string) {
  for (const route of routes) {
    const paramNames: string[] = [];
    const regexStr = route.pattern.replace(/:([^/]+)/g, (_, name) => {
      paramNames.push(name);
      return "([^/]+)";
    });
    const match = pathname.match(new RegExp(`^${regexStr}$`));
    if (match) {
      const params: Record<string, string> = {};
      paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });
      return { handler: route.handler, params };
    }
  }
  return null;
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const pathname = url.pathname;

  const matched = matchRoute(pathname);

  if (!matched) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: `No route: ${req.method} ${pathname}` }));
    return;
  }

  // Inject path params onto req and add res.json helper
  (req as Parameters<Handler>[0]).params = matched.params;
  (res as Parameters<Handler>[1] & { json: (b: unknown) => void }).json = (body: unknown) => {
    res.writeHead(res.statusCode || 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body, null, 2));
  };

  try {
    await matched.handler(req as Parameters<Handler>[0], res as Parameters<Handler>[1]);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: String(err) }));
  }
});

function shutdown() {
  server.close();
  try {
    db.close();
  } catch {
    /* ignore — OS will release file descriptors on exit */
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, () => {
  console.log(`\nRemiry dev server running at http://localhost:${PORT}`);
  console.log(`Database:  ${new URL("./dev.db", import.meta.url).pathname}\n`);
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const later = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

  console.log("Quick smoke test — run these in order in another terminal:\n");

  console.log(`  # 1. Create a reminder (event — needs date + time)`);
  console.log(`  curl -s -X POST http://localhost:${PORT}/remiry/items \\`);
  console.log(`    -H 'Content-Type: application/json' \\`);
  console.log(
    `    -d '{"type":"remind","name":"Dentist","target_date":"${today} 10:00","desc":"Annual checkup"}'\n`,
  );

  console.log(`  # 2. Create an expiry item (hard expiry)`);
  console.log(`  curl -s -X POST http://localhost:${PORT}/remiry/items \\`);
  console.log(`    -H 'Content-Type: application/json' \\`);
  console.log(
    `    -d '{"type":"expire","name":"Yogurt","target_date":"${soon}"}'\n`,
  );

  console.log(`  # 3. Create a best-before item`);
  console.log(`  curl -s -X POST http://localhost:${PORT}/remiry/items \\`);
  console.log(`    -H 'Content-Type: application/json' \\`);
  console.log(
    `    -d '{"type":"expire","name":"Milk","target_date":"${later}","bbf":true}'\n`,
  );

  console.log(
    `  # 4. One-stop summary — today's items + next 7 days (primary endpoint)`,
  );
  console.log(`  curl -s "http://localhost:${PORT}/remiry/summary" | jq\n`);

  console.log(`  # 5. Summary for a specific date + 30 days ahead`);
  console.log(
    `  curl -s "http://localhost:${PORT}/remiry/summary?date=${today}&upcoming_days=30" | jq\n`,
  );

  console.log(`  # 6. List all items`);
  console.log(`  curl -s http://localhost:${PORT}/remiry/items | jq\n`);

  console.log(`  # 7. Update item 1 (change time)`);
  console.log(`  curl -s -X PUT http://localhost:${PORT}/remiry/items/1 \\`);
  console.log(`    -H 'Content-Type: application/json' \\`);
  console.log(`    -d '{"target_date":"${today} 14:30"}'\n`);

  console.log(`  # 8. Delete item 1`);
  console.log(`  curl -s -X DELETE http://localhost:${PORT}/remiry/items/1\n`);
  console.log(`  # 9. Clear ALL items (start fresh)`);
  console.log(`  curl -s -X DELETE "http://localhost:${PORT}/remiry/items?confirm=true"\n`);

  console.log("  (remove '| jq' if jq is not installed)\n");
  console.log("Press Ctrl+C to stop.\n");
});
