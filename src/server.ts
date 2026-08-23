import { McpServer } from "@modelcontextprotocol/server";
import type { DesktopBackend } from "./backend/DesktopBackend.js";
import { ActionGuard } from "./safety/ActionGuard.js";
import { registerKeyboardTools } from "./tools/keyboardTools.js";
import { registerMouseTools } from "./tools/mouseTools.js";
import { registerObservationTools } from "./tools/observationTools.js";
import { registerScreenshotTools } from "./tools/screenshotTools.js";
import { registerWindowTools } from "./tools/windowTools.js";

export function createServer(backend: DesktopBackend): McpServer {
  const server = new McpServer({ name: "clui", version: "0.1.0" });
  const context = { backend, guard: new ActionGuard() };
  registerWindowTools(server, context);
  registerScreenshotTools(server, context);
  registerMouseTools(server, context);
  registerKeyboardTools(server, context);
  registerObservationTools(server, context);
  return server;
}
