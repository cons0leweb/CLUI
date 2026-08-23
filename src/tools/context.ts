import type { DesktopBackend } from "../backend/DesktopBackend.js";
import { log, summarizeToolInput } from "../logging.js";
import type { ActionGuard } from "../safety/ActionGuard.js";

export interface ToolContext {
  backend: DesktopBackend;
  guard: ActionGuard;
}

export async function executeTool<T>(
  context: ToolContext,
  name: string,
  input: unknown,
  operation: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  const classification = context.guard.classify(name, input);
  log("info", "tool_call", { tool: name, classification, input: summarizeToolInput(name, input) });
  try {
    await context.guard.authorize(name, classification);
    const result = await operation();
    log("info", "tool_complete", { tool: name, classification, duration_ms: Math.round(performance.now() - started) });
    return result;
  } catch (error) {
    log("error", "tool_failure", {
      tool: name,
      classification,
      duration_ms: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function screenshotResult(screenshot: { png: Buffer; width?: number; height?: number; source: string; backend: string }, metadata: Record<string, unknown> = {}) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify({ source: screenshot.source, backend: screenshot.backend, width: screenshot.width, height: screenshot.height, ...metadata }, null, 2) },
      { type: "image" as const, data: screenshot.png.toString("base64"), mimeType: "image/png" as const },
    ],
  };
}
