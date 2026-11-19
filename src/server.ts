import { publishVisual } from "./events/VisualEventPublisher.js";
import { ActionExecutor } from "./actions/ActionExecutor.js";
import { PreconditionValidator } from "./actions/PreconditionValidator.js";
import { describeIndicatorAction } from "./indicator/actionDescription.js";
import type { CursorIndicator } from "./indicator/CursorIndicator.js";
import { registerIndicatorTools } from "./tools/indicatorTools.js";
import { McpServer } from "@modelcontextprotocol/server";
import type { DesktopBackend } from "./backend/DesktopBackend.js";
import { ActionGuard } from "./safety/ActionGuard.js";
import type { ScreenMapService } from "./screenmap/ScreenMapService.js";
import { registerClipboardTools } from "./tools/clipboardTools.js";
import { registerKeyboardTools } from "./tools/keyboardTools.js";
import { registerMouseTools } from "./tools/mouseTools.js";
import { registerObservationTools } from "./tools/observationTools.js";
import { registerScreenshotTools } from "./tools/screenshotTools.js";
import { registerScreenMapTools } from "./tools/screenMapTools.js";
import { registerWindowTools } from "./tools/windowTools.js";

export function createServer(backend: DesktopBackend, screenMap: ScreenMapService, indicator?: CursorIndicator): McpServer {
  const server = new McpServer({ name: "clui", version: "0.2.0" });
  const guard = new ActionGuard(async ({ tool, input, signal }) => {
    const label = await describeIndicatorAction(tool, input, backend, screenMap);
    const identity = input as { request_id?: string; step_index?: number };
    const began = Date.now();
    publishVisual("approval");
    try {
      const response = await server.server.elicitInput({ mode: "form", message: `CLUI requests human approval: ${label}. Request ${identity.request_id}, step ${identity.step_index}. Allow this one action?`, requestedSchema: { type: "object", properties: { approve: { type: "boolean", title: "Allow this action", default: false } }, required: ["approve"] } }, { timeout: 30_000, ...(signal ? { signal } : {}) });
      if (Date.now() - began > 30_000) return "unavailable";
      return response.action === "accept" && response.content?.approve === true ? "approved" : "denied";
    } finally { publishVisual("approval", "end"); }
  });
  const executor = new ActionExecutor(backend, new PreconditionValidator(backend, screenMap), guard);
  const context = { backend, guard, screenMap, executor, ...(indicator ? { indicator } : {}) };
  registerIndicatorTools(server, context);
  registerClipboardTools(server, context);
  registerWindowTools(server, context);
  registerScreenshotTools(server, context);
  registerMouseTools(server, context);
  registerKeyboardTools(server, context);
  registerObservationTools(server, context);
  registerScreenMapTools(server, context);
  return server;
}
