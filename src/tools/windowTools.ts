import { withActionFields } from "./schemas.js";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ToolContext } from "./context.js";
import { withToolRequest, executeTool, textResult } from "./context.js";
import { windowIdSchema } from "./schemas.js";

export function registerWindowTools(server: McpServer, context: ToolContext): void {
  server.registerTool("desktop_get_active_window", {
    description: "Get the active X11 top-level window, including title, class, PID, and screen geometry.",
    inputSchema: z.object({}),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_get_active_window", input, async () => textResult(await context.backend.getActiveWindow())));

  server.registerTool("desktop_list_windows", {
    description: "List visible, mapped top-level X11 application windows; desktop, docks, menus, and helper windows are filtered out.",
    inputSchema: z.object({}),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_list_windows", input, async () => textResult(await context.backend.listWindows())));

  server.registerTool("desktop_find_window", {
    description: "Find visible windows by case-insensitive title substring, with optional class substring and PID filters.",
    inputSchema: z.object({ title: z.string().min(1), class: z.string().min(1).optional(), pid: z.number().int().positive().optional() }),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_find_window", input, async () => textResult(await context.backend.findWindows({
    title: input.title,
    ...(input.class ? { className: input.class } : {}),
    ...(input.pid ? { pid: input.pid } : {}),
  }))));

  server.registerTool("desktop_get_window_info", {
    description: "Get title, process metadata, mapping state, and absolute screen geometry for one X11 window.",
    inputSchema: z.object({ window_id: windowIdSchema }),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_get_window_info", input, async () => textResult(await context.backend.getWindowInfo(input.window_id))));

  server.registerTool("desktop_focus_window", {
    description: "Activate a window by id or title substring and verify _NET_ACTIVE_WINDOW before returning.",
    inputSchema: withActionFields(z.object({ window_id: windowIdSchema.optional(), title: z.string().min(1).optional(), timeout_ms: z.number().int().min(100).max(10_000).default(2_000) }).refine((value) => Boolean(value.window_id) !== Boolean(value.title), "Provide exactly one of window_id or title")),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_focus_window", input, async () => textResult(await context.backend.focusWindow({
    ...(input.window_id ? { windowId: input.window_id } : {}),
    ...(input.title ? { title: input.title } : {}),
  }, input.timeout_ms))));
  server.registerTool("desktop_configure_window", {
    description: "Move, resize, maximize, minimize, or restore an X11 window. Returns observed geometry; window-manager constraints may apply. Maximize/restore require wmctrl.",
    inputSchema: withActionFields(z.object({
      window_id: windowIdSchema,
      x: z.number().int().optional(), y: z.number().int().optional(),
      width: z.number().int().min(1).max(32768).optional(), height: z.number().int().min(1).max(32768).optional(),
      state: z.enum(["maximize", "minimize", "restore"]).optional(),
    }).refine((v) => v.x !== undefined || v.y !== undefined || v.width !== undefined || v.height !== undefined || v.state !== undefined, "Provide geometry or state")),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_configure_window", input, async () => {
    const { window_id, ...options } = input;
    return textResult(await context.backend.configureWindow(window_id, {
      ...(options.x !== undefined ? { x: options.x } : {}), ...(options.y !== undefined ? { y: options.y } : {}),
      ...(options.width !== undefined ? { width: options.width } : {}), ...(options.height !== undefined ? { height: options.height } : {}),
      ...(options.state !== undefined ? { state: options.state } : {}),
    }));
  }));

  server.registerTool("desktop_list_surfaces", {
    description: "List mapped X11 menus, popup menus, tooltips, dialogs, and notifications, including override-redirect windows omitted from the normal window list. Returns partial=true if enumeration was incomplete. Use IDs with desktop_screenshot or desktop_observe_marked.",
    inputSchema: z.object({}),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_list_surfaces", input, async () => textResult(await context.backend.listSurfaces())));
}
