import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ToolContext } from "./context.js";
import { withToolRequest, executeTool, textResult } from "./context.js";

export function registerIndicatorTools(server: McpServer, context: ToolContext): void {
  server.registerTool("desktop_control_session", {
    description: "Begin/end the visible CLUI cursor indicator session, or read its status. Begin keeps it visible between tool calls until end or the timeout (default 60 seconds, max 10 minutes). This indicates CLUI activity; it does not lock physical input. Status available=null means the helper has not reported ready yet.",
    inputSchema: z.object({ action: z.enum(["begin", "end", "status"]), timeout_ms: z.number().int().min(1_000).max(600_000).default(60_000) }),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_control_session", input, async () => {
    if (input.action === "begin") context.indicator?.beginSession(input.timeout_ms);
    if (input.action === "end") context.indicator?.endSession();
    return textResult(context.indicator?.status() ?? { enabled: false, available: false, session_active: false, active_actions: 0 });
  }));
}
