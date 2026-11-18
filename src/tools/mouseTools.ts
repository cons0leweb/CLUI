import { withActionFields } from "./schemas.js";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { windowRelativePoint } from "../backend/DesktopBackend.js";
import type { ToolContext } from "./context.js";
import { withToolRequest, executeTool, textResult } from "./context.js";
import { coordinateSchema, durationSchema, mouseButtonSchema, windowIdSchema, windowPointSchema } from "./schemas.js";

async function resolveWindowPoint(context: ToolContext, input: { window_id: string; x: number; y: number; normalized: boolean }) {
  return windowRelativePoint(await context.backend.getWindowInfo(input.window_id), input.x, input.y, input.normalized);
}

export function registerMouseTools(server: McpServer, context: ToolContext): void {
  server.registerTool("desktop_get_mouse_position", { description: "Get the current global X11 mouse coordinates.", inputSchema: z.object({}) },
    async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_get_mouse_position", input, async () => textResult(await context.backend.getMousePosition())));

  server.registerTool("desktop_move_mouse", {
    description: "Move the mouse to absolute global screen coordinates.",
    inputSchema: withActionFields(z.object({ x: coordinateSchema, y: coordinateSchema, duration_ms: durationSchema.default(0) })),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_move_mouse", input, async () => textResult(await context.backend.moveMouse(input.x, input.y, input.duration_ms))));

  server.registerTool("desktop_move_mouse_window", {
    description: "Move the mouse to pixel or normalized coordinates relative to a window's client geometry.",
    inputSchema: withActionFields(windowPointSchema.extend({ duration_ms: durationSchema.default(0) })),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_move_mouse_window", input, async () => {
    const point = await resolveWindowPoint(context, input);
    await context.backend.moveMouse(point.x, point.y, input.duration_ms);
    return textResult({ ...point, window_id: input.window_id, normalized: input.normalized });
  }));

  server.registerTool("desktop_click", {
    description: "Optionally move to global coordinates, then click the selected mouse button.",
    inputSchema: withActionFields(z.object({ x: coordinateSchema.optional(), y: coordinateSchema.optional(), button: mouseButtonSchema.default("left"), count: z.number().int().min(1).max(10).default(1), interval_ms: z.number().int().min(0).max(2_000).default(100) }).refine((value) => (value.x === undefined) === (value.y === undefined), "x and y must be provided together")),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_click", input, async () => {
    if (input.x !== undefined && input.y !== undefined) await context.backend.moveMouse(input.x, input.y);
    await context.backend.clickMouse(input.button, input.count, input.interval_ms);
    return textResult({ clicked: true, button: input.button, count: input.count });
  }));

  server.registerTool("desktop_click_window", {
    description: "Click at pixel or normalized coordinates relative to a specific window.",
    inputSchema: withActionFields(windowPointSchema.extend({ button: mouseButtonSchema.default("left"), count: z.number().int().min(1).max(10).default(1), interval_ms: z.number().int().min(0).max(2_000).default(100) })),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_click_window", input, async () => {
    const point = await resolveWindowPoint(context, input);
    await context.backend.moveMouse(point.x, point.y);
    await context.backend.clickMouse(input.button, input.count, input.interval_ms);
    return textResult({ clicked: true, ...point, button: input.button, count: input.count });
  }));

  for (const [name, method] of [["desktop_mouse_down", "down"], ["desktop_mouse_up", "up"]] as const) {
    server.registerTool(name, { description: `${method === "down" ? "Press" : "Release"} a mouse button without the matching opposite event.`, inputSchema: withActionFields(z.object({ button: mouseButtonSchema.default("left") })) },
      async (input, extra) => executeTool(withToolRequest(context, extra), name, input, async () => {
        if (method === "down") await context.backend.mouseDown(input.button); else await context.backend.mouseUp(input.button);
        return textResult({ button: input.button, state: method });
      }));
  }

  server.registerTool("desktop_scroll", {
    description: "Scroll using X11 wheel button events; negative Y is up, positive Y is down, negative X is left.",
    inputSchema: withActionFields(z.object({ delta_x: z.number().int().min(-100).max(100).default(0), delta_y: z.number().int().min(-100).max(100).default(0) })),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_scroll", input, async () => {
    await context.backend.scroll(input.delta_x, input.delta_y);
    return textResult({ scrolled: true, delta_x: input.delta_x, delta_y: input.delta_y });
  }));
  server.registerTool("desktop_drag", {
    description: "Drag between absolute screen points, releasing the button even if movement fails.",
    inputSchema: withActionFields(z.object({
      from: z.object({ x: z.number().int(), y: z.number().int() }),
      to: z.object({ x: z.number().int(), y: z.number().int() }),
      button: mouseButtonSchema.default("left"),
      duration_ms: z.number().int().min(100).max(5_000).default(600),
    })),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_drag", input, async () => {
    await context.backend.drag(input.from, input.to, input.button, input.duration_ms);
    return textResult({ dragged: true });
  }));
}
