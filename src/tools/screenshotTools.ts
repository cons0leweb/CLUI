import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolContext } from "./context.js";
import { executeTool, screenshotResult } from "./context.js";
import { screenshotSchema } from "./schemas.js";

export function registerScreenshotTools(server: McpServer, context: ToolContext): void {
  server.registerTool("desktop_screenshot", {
    description: "Capture a PNG of the full screen, active window, specific window, or screen region. Returns an MCP image content block.",
    inputSchema: screenshotSchema,
  }, async (input) => executeTool(context, "desktop_screenshot", input, async () => screenshotResult(await context.backend.screenshot({
    mode: input.mode,
    ...(input.window_id ? { windowId: input.window_id } : {}),
    ...(input.region ? { region: input.region } : {}),
    ...(input.max_width ? { maxWidth: input.max_width } : {}),
    ...(input.max_height ? { maxHeight: input.max_height } : {}),
  }))));
}
