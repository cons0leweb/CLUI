import { withActionFields } from "./schemas.js";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ToolContext } from "./context.js";
import { withToolRequest, executeTool, textResult } from "./context.js";

export function registerClipboardTools(server: McpServer, context: ToolContext): void {
  server.registerTool("desktop_read_clipboard", {
    description: "Read UTF-8 text from the X11 clipboard (up to 4 MiB); requires xclip.",
    inputSchema: z.object({}),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_read_clipboard", input, async () => textResult({ text: await context.backend.readClipboard() })));

  server.registerTool("desktop_write_clipboard", {
    description: "Replace the X11 clipboard with literal UTF-8 text; requires xclip. Does not paste automatically.",
    inputSchema: withActionFields(z.object({ text: z.string().max(1_000_000) })),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_write_clipboard", input, async () => {
    await context.backend.writeClipboard(input.text);
    return textResult({ written: true, length: input.text.length });
  }));
}
