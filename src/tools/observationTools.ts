import { withActionFields } from "./schemas.js";
import { describeIndicatorAction } from "../indicator/actionDescription.js";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { windowRelativePoint } from "../backend/DesktopBackend.js";
import type { ToolContext } from "./context.js";
import { withToolRequest, executeTool, screenshotResult, textResult } from "./context.js";
import { actSchema, dimensionSchema, windowIdSchema } from "./schemas.js";

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function registerObservationTools(server: McpServer, context: ToolContext): void {
  server.registerTool("desktop_get_capabilities", {
    description: "Report the detected session, fixed executable allowlist, screenshot backend, and current X11 feature availability.",
    inputSchema: z.object({}),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_get_capabilities", input, async () => textResult({
    action_session_id: context.executor?.sessionId,
    execution_policy: context.executor?.getStatus(),
    cursor_indicator: context.indicator?.status() ?? { enabled: false, available: false },
    backend: context.backend.name,
    ...context.backend.capabilities,
    ...(await context.screenMap.getCapabilities()),
  })));

  server.registerTool("desktop_get_screen_info", {
    description: "Get root-screen dimensions and, when xrandr is installed, the connected monitor layout.",
    inputSchema: z.object({}),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_get_screen_info", input, async () => textResult(await context.backend.getScreenInfo())));

  server.registerTool("desktop_observe", {
    description: "Primary visual-loop observation: active window, mouse position, screen info, PNG screenshot, and optional window summary.",
    inputSchema: z.object({
      screenshot_mode: z.enum(["screen", "active_window", "window"]).default("screen"),
      window_id: windowIdSchema.optional(),
      include_windows: z.boolean().default(false),
      max_width: dimensionSchema.optional(),
      max_height: dimensionSchema.optional(),
    }).refine((value) => value.screenshot_mode !== "window" || Boolean(value.window_id), "window_id is required when screenshot_mode=window"),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_observe", input, async () => {
    const results = await Promise.allSettled([
      context.backend.getActiveWindow(),
      context.backend.getMousePosition(),
      context.backend.getScreenInfo(),
      input.include_windows ? context.backend.listWindows() : Promise.resolve(undefined),
    ]);
    const [activeResult, mouseResult, screenResult, windowsResult] = results;
    const errorOf = (result: PromiseSettledResult<unknown>) => result.status === "rejected"
      ? (result.reason instanceof Error ? result.reason.message : String(result.reason)) : undefined;
    const activeWindow = activeResult.status === "fulfilled" ? activeResult.value : null;
    const mousePosition = mouseResult.status === "fulfilled" ? mouseResult.value : null;
    const screen = screenResult.status === "fulfilled" ? screenResult.value : null;
    const windows = windowsResult.status === "fulfilled" ? windowsResult.value : undefined;
    const screenshot = await context.backend.screenshot({
      mode: input.screenshot_mode,
      ...(input.window_id ? { windowId: input.window_id } : {}),
      ...(input.max_width ? { maxWidth: input.max_width } : {}),
      ...(input.max_height ? { maxHeight: input.max_height } : {}),
    });
    return screenshotResult(screenshot, {
      active_window: activeWindow,
      mouse_position: mousePosition,
      screen,
      ...(windows ? { windows: windows.map(({ id, title, class: className, pid, x, y, width, height }) => ({ id, title, class: className, pid, x, y, width, height })) } : {}),
      observation_errors: Object.fromEntries([
        ["active_window", errorOf(activeResult)], ["mouse_position", errorOf(mouseResult)],
        ["screen", errorOf(screenResult)], ["windows", input.include_windows ? errorOf(windowsResult) : undefined],
      ].filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    });
  }));

  server.registerTool("desktop_wait", {
    description: "Wait briefly for a GUI animation, render, or load to settle (maximum 10 seconds).",
    inputSchema: withActionFields(z.object({ milliseconds: z.number().int().min(0).max(10_000) })),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_wait", input, async () => {
    await sleep(input.milliseconds);
    return textResult({ waited_ms: input.milliseconds });
  }));

  server.registerTool("desktop_act", {
    description: "Run up to 20 ordered GUI-only actions: focus, move, click, key, type, wait, or scroll. No shell action exists.",
    inputSchema: actSchema,
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_act", input, async () => {
    if (!context.executor) throw new Error("Action executor is unavailable");
    const names = { focus: "desktop_focus_window", move: "desktop_move_mouse", click: "desktop_click", key: "desktop_key_press", type: "desktop_type_text", wait: "desktop_wait", scroll: "desktop_scroll" };
    const steps = input.actions.map((action) => ({
      name: names[action.type],
      input: { ...action, preconditions: action.preconditions ?? input.preconditions, expected_window_id: action.expected_window_id ?? input.expected_window_id },
      run: async () => {
        const finish = context.indicator?.beginAction(await describeIndicatorAction(names[action.type], action, context.backend, context.screenMap));
        try {
       switch (action.type) {
        case "focus":
          await context.backend.focusWindow({
            ...(action.window_id ? { windowId: action.window_id } : {}),
            ...(action.title ? { title: action.title } : {}),
          }, action.timeout_ms);
          break;
        case "move": {
          const point = action.window_id
            ? windowRelativePoint(await context.backend.getWindowInfo(action.window_id), action.x, action.y, action.normalized)
            : { x: action.x, y: action.y };
          await context.backend.moveMouse(point.x, point.y, action.duration_ms);
          break;
        }
        case "click": {
          if ((action.x === undefined) !== (action.y === undefined)) throw new Error("x and y must be provided together");
          if (action.x !== undefined && action.y !== undefined) {
            const point = action.window_id
              ? windowRelativePoint(await context.backend.getWindowInfo(action.window_id), action.x, action.y, action.normalized)
              : { x: action.x, y: action.y };
            await context.backend.moveMouse(point.x, point.y);
          }
          await context.backend.clickMouse(action.button, action.count, action.interval_ms);
          break;
        }
        case "key": await context.backend.keyPress(action.key, action.modifiers); break;
        case "type": await context.backend.typeText(action.text, action.interval_ms); break;
        case "wait": await sleep(action.milliseconds); break;
        case "scroll": await context.backend.scroll(action.delta_x, action.delta_y); break;
       }

          return { type: action.type };
        } finally { finish?.(); }
      },
    }));
    return textResult(await context.executor.execute(input, steps, extra.mcpReq.signal));
  }));
}
