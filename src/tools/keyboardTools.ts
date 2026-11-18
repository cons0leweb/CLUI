import { withActionFields } from "./schemas.js";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ToolContext } from "./context.js";
import { withToolRequest, executeTool, textResult } from "./context.js";
import { modifierSchema } from "./schemas.js";

const keySchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_]+(?:\+[A-Za-z0-9_]+)*$/);

export function registerKeyboardTools(server: McpServer, context: ToolContext): void {
  server.registerTool("desktop_key_press", {
    description: "Press and release one X11 key with optional Ctrl, Alt, Shift, or Super modifiers.",
    inputSchema: withActionFields(z.object({ key: keySchema, modifiers: z.array(modifierSchema).max(4).default([]) })),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_key_press", input, async () => {
    await context.backend.keyPress(input.key, input.modifiers);
    return textResult({ pressed: true, key: input.key, modifiers: input.modifiers });
  }));

  server.registerTool("desktop_key_down", {
    description: "Hold an X11 key down. The caller is responsible for a matching desktop_key_up.",
    inputSchema: withActionFields(z.object({ key: keySchema })),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_key_down", input, async () => {
    await context.backend.keyDown(input.key);
    return textResult({ key: input.key, state: "down" });
  }));

  server.registerTool("desktop_key_up", {
    description: "Release an X11 key previously held with desktop_key_down.",
    inputSchema: withActionFields(z.object({ key: keySchema })),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_key_up", input, async () => {
    await context.backend.keyUp(input.key);
    return textResult({ key: input.key, state: "up" });
  }));

  server.registerTool("desktop_type_text", {
    description: "Type literal text through xdotool without shell interpolation. Supports spaces, punctuation, multiline text, and backend-dependent Unicode.",
    inputSchema: withActionFields(z.object({ text: z.string().max(100_000), interval_ms: z.number().int().min(0).max(1_000).default(12) })),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_type_text", input, async () => {
    await context.backend.typeText(input.text, input.interval_ms);
    return textResult({ typed: true, length: input.text.length, interval_ms: input.interval_ms });
  }));
}
