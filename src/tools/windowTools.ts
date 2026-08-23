import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ToolContext } from "./context.js";
import { executeTool, textResult } from "./context.js";
import { windowIdSchema } from "./schemas.js";

export function registerWindowTools(server: McpServer, context: ToolContext): void {
  server.registerTool("desktop_get_active_window", {
    description: "Get the active X11 top-level window, including title, class, PID, and screen geometry.",
    inputSchema: z.object({}),
  }, async (input) => executeTool(context, "desktop_get_active_window", input, async () => textResult(await context.backend.getActiveWindow())));

  server.registerTool("desktop_list_windows", {
    description: "List visible, mapped top-level X11 application windows; desktop, docks, menus, and helper windows are filtered out.",
    inputSchema: z.object({}),
  }, async (input) => executeTool(context, "desktop_list_windows", input, async () => textResult(await context.backend.listWindows())));

  server.registerTool("desktop_find_window", {
    description: "Find visible windows by case-insensitive title substring, with optional class substring and PID filters.",
    inputSchema: z.object({ title: z.string().min(1), class: z.string().min(1).optional(), pid: z.number().int().positive().optional() }),
  }, async (input) => executeTool(context, "desktop_find_window", input, async () => textResult(await context.backend.findWindows({
    title: input.title,
    ...(input.class ? { className: input.class } : {}),
    ...(input.pid ? { pid: input.pid } : {}),
  }))));

  server.registerTool("desktop_get_window_info", {
    description: "Get title, process metadata, mapping state, and absolute screen geometry for one X11 window.",
    inputSchema: z.object({ window_id: windowIdSchema }),
  }, async (input) => executeTool(context, "desktop_get_window_info", input, async () => textResult(await context.backend.getWindowInfo(input.window_id))));

  server.registerTool("desktop_focus_window", {
    description: "Activate a window by id or title substring and verify _NET_ACTIVE_WINDOW before returning.",
    inputSchema: z.object({ window_id: windowIdSchema.optional(), title: z.string().min(1).optional(), timeout_ms: z.number().int().min(100).max(10_000).default(2_000) }).refine((value) => Boolean(value.window_id) !== Boolean(value.title), "Provide exactly one of window_id or title"),
  }, async (input) => executeTool(context, "desktop_focus_window", input, async () => textResult(await context.backend.focusWindow({
    ...(input.window_id ? { windowId: input.window_id } : {}),
    ...(input.title ? { title: input.title } : {}),
  }, input.timeout_ms))));
}
