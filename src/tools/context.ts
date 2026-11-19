import { publishOutcome } from "../events/VisualEventPublisher.js";
import type { ActionExecutor } from "../actions/ActionExecutor.js";
import { describeIndicatorAction } from "../indicator/actionDescription.js";
import type { CursorIndicator } from "../indicator/CursorIndicator.js";
import type { DesktopBackend } from "../backend/DesktopBackend.js";
import type { ScreenMapService } from "../screenmap/ScreenMapService.js";
import { log, summarizeToolInput } from "../logging.js";
import type { ActionGuard } from "../safety/ActionGuard.js";

export interface ToolContext {
  backend: DesktopBackend;
  guard: ActionGuard;
  screenMap: ScreenMapService;
  indicator?: CursorIndicator;
  executor?: ActionExecutor;
  requestSignal?: AbortSignal;
}

export function withToolRequest(context: ToolContext, request: { mcpReq: { signal: AbortSignal } }): ToolContext {
  return { ...context, requestSignal: request.mcpReq.signal };
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
  let finishIndicator: (() => void) | undefined;
  try {
    if (context.executor && classification !== "read_only" && name !== "desktop_act" && name !== "desktop_control_session") {
      const result = await context.executor.execute(input as Record<string, unknown>, [{ name, input: input as Record<string, unknown>, run: async () => dispatchPayload(await runOperation()) }], context.requestSignal);
      publishOutcome(result.status);
      return textResult(result) as T;
    }
    if (!context.executor || classification === "read_only") await context.guard.authorize(name, classification);
    return await runOperation();
  } catch (error) {
    log("error", "tool_failure", { tool: name, classification, reason: "tool_operation_failed" });
    throw error;
  }

  async function runOperation(): Promise<T> {
    try {
      if (context.indicator && name !== "desktop_control_session" && (classification !== "read_only" || context.indicator.status().session_active)) {
        finishIndicator = context.indicator.beginAction(await describeIndicatorAction(name, input, context.backend, context.screenMap));
      }
      const observationToken = context.executor?.observationToken;
      const result = await operation();
      if (name === "desktop_act") {
        const outcome = dispatchPayload(result) as { status?: unknown };
        if (typeof outcome?.status === "string") publishOutcome(outcome.status);
      }
      if (name === "desktop_observe" || name === "desktop_observe_marked") context.executor?.markObserved(observationToken);
      log("info", "tool_complete", { tool: name, classification, duration_ms: Math.round(performance.now() - started) });
      return result;
    } finally {
      finishIndicator?.();
    }
  }
}

function dispatchPayload(value: unknown): unknown {
  const result = value as { content?: Array<{ type: string; text?: string }> };
  if (result?.content?.length === 1 && result.content[0]?.type === "text" && typeof result.content[0].text === "string") {
    try { return JSON.parse(result.content[0].text); } catch { return value; }
  }
  return value;
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
