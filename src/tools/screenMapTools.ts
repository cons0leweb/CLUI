import { withActionFields } from "./schemas.js";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ScreenElement } from "../types/screenMap.js";
import type { ToolContext } from "./context.js";
import { withToolRequest, executeTool, screenshotResult, textResult } from "./context.js";
import { dimensionSchema, mouseButtonSchema, windowIdSchema } from "./schemas.js";

export const snapshotIdSchema = z.string().uuid();
export const elementIdSchema = z.number().int().positive();
export const clickPositionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("center") }),
  z.object({ type: z.literal("top_left") }),
  z.object({ type: z.literal("custom"), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
]);

export const observeMarkedSchema = z.object({
  window_id: windowIdSchema.optional(),
  title: z.string().min(1).optional(),
  class: z.string().min(1).optional(),
  active_window: z.boolean().optional(),
  max_width: dimensionSchema.optional(),
  max_height: dimensionSchema.optional(),
  include_non_interactive: z.boolean().default(false),
  max_elements: z.number().int().min(1).max(500).default(150),
}).superRefine((value, issue) => {
  const explicitSelectors = Number(Boolean(value.window_id)) + Number(Boolean(value.title || value.class));
  if (explicitSelectors > 1 || (value.active_window === true && explicitSelectors > 0) || (value.active_window === false && explicitSelectors === 0)) {
    issue.addIssue({ code: "custom", message: "Choose one target: window_id, title/class query, or active_window=true; omitting all selectors also uses the active window" });
  }
});

function publicSnapshot(snapshot: ReturnType<ToolContext["screenMap"]["getSnapshot"]>) {
  return {
    snapshot_id: snapshot.snapshotId,
    created_at: snapshot.createdAt,
    expires_at: snapshot.expiresAt,
    window: snapshot.window,
    screen_map_available: snapshot.screenMapAvailable,
    annotated_screenshot_available: snapshot.annotatedScreenshotAvailable,
    reason: snapshot.reason,
    element_count: snapshot.elements.length,
    elements: snapshot.elements,
  };
}

export function filterSnapshotElements(elements: readonly ScreenElement[], filters: { role?: string; labelContains?: string; interactiveOnly?: boolean; visibleOnly?: boolean }): ScreenElement[] {
  const role = filters.role?.toLocaleLowerCase();
  const label = filters.labelContains?.toLocaleLowerCase();
  return elements.filter((element) => {
    if (role && element.role.toLocaleLowerCase() !== role) return false;
    if (label && !(element.label ?? "").toLocaleLowerCase().includes(label)) return false;
    if (filters.interactiveOnly && !(element.clickable || element.focusable || element.editable)) return false;
    return !filters.visibleOnly || element.visible;
  });
}

export function registerScreenMapTools(server: McpServer, context: ToolContext): void {
  server.registerTool("desktop_observe_marked", {
    description: "Capture one X11 window, read its AT-SPI accessibility tree, and return an immutable snapshot with numbered elements and an annotated PNG. Falls back to the raw PNG when accessibility is unavailable.",
    inputSchema: observeMarkedSchema,
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_observe_marked", input, async () => {
    const snapshot = await context.screenMap.observe({
      ...(input.window_id ? { windowId: input.window_id } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.class ? { className: input.class } : {}),
      ...(input.active_window !== undefined ? { activeWindow: input.active_window } : {}),
      ...(input.max_width ? { maxWidth: input.max_width } : {}),
      ...(input.max_height ? { maxHeight: input.max_height } : {}),
      includeNonInteractive: input.include_non_interactive,
      maxElements: input.max_elements,
    });
    return screenshotResult(snapshot.screenshot, publicSnapshot(snapshot));
  }));

  server.registerTool("desktop_get_elements", {
    description: "Filter elements from an existing ScreenMap snapshot without rescanning the desktop.",
    inputSchema: z.object({
      snapshot_id: snapshotIdSchema,
      role: z.string().min(1).optional(),
      label_contains: z.string().min(1).optional(),
      interactive_only: z.boolean().default(false),
      visible_only: z.boolean().default(true),
    }),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_get_elements", input, async () => {
    const snapshot = context.screenMap.getSnapshot(input.snapshot_id);
    const elements = filterSnapshotElements(snapshot.elements, {
      ...(input.role ? { role: input.role } : {}),
      ...(input.label_contains ? { labelContains: input.label_contains } : {}),
      interactiveOnly: input.interactive_only,
      visibleOnly: input.visible_only,
    });
    return textResult({ snapshot_id: snapshot.snapshotId, count: elements.length, elements });
  }));

  server.registerTool("desktop_element_info", {
    description: "Return one complete element object from an existing ScreenMap snapshot.",
    inputSchema: z.object({ snapshot_id: snapshotIdSchema, element_id: elementIdSchema }),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_element_info", input, async () => textResult({
    snapshot_id: input.snapshot_id,
    element: context.screenMap.getElement(input.snapshot_id, input.element_id),
  })));

  server.registerTool("desktop_click_element", {
    description: "Click a numbered ScreenMap element after checking snapshot lifetime and current window geometry.",
    inputSchema: withActionFields(z.object({
      snapshot_id: snapshotIdSchema,
      element_id: elementIdSchema,
      button: mouseButtonSchema.default("left"),
      click_position: clickPositionSchema.default({ type: "center" }),
    })),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_click_element", input, async () => {
    const result = await context.screenMap.clickElement(input.snapshot_id, input.element_id, input.button, input.click_position);
    return textResult({ snapshot_id: input.snapshot_id, element_id: input.element_id, clicked_at: result.point, button: input.button });
  }));

  server.registerTool("desktop_focus_element", {
    description: "Focus a checked element using AT-SPI Component.GrabFocus. An attempted accessibility focus is never retried as a physical click.",
    inputSchema: withActionFields(z.object({ snapshot_id: snapshotIdSchema, element_id: elementIdSchema })),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_focus_element", input, async () => textResult({
    snapshot_id: input.snapshot_id,
    element_id: input.element_id,
    ...(await context.screenMap.focusElement(input.snapshot_id, input.element_id)),
  })));
  server.registerTool("desktop_scroll_element", {
    description: "Position the pointer inside a checked ScreenMap container and scroll there. Deltas are wheel steps. Observe again after scrolling; nested controls may intercept wheel events.",
    inputSchema: withActionFields(z.object({ snapshot_id: snapshotIdSchema, element_id: elementIdSchema,
      delta_x: z.number().int().min(-100).max(100).default(0), delta_y: z.number().int().min(-100).max(100).default(0) })),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_scroll_element", input, async () => {
    await context.screenMap.scrollElement(input.snapshot_id, input.element_id, input.delta_x, input.delta_y);
    return textResult({ scrolled: true, observe_again: true });
  }));

  server.registerTool("desktop_drag_element", {
    description: "Drag between two checked elements in the same ScreenMap snapshot. Always attempts button release.",
    inputSchema: withActionFields(z.object({ snapshot_id: snapshotIdSchema, from_element_id: elementIdSchema, to_element_id: elementIdSchema,
      button: mouseButtonSchema.default("left"), duration_ms: z.number().int().min(100).max(5_000).default(600) })),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_drag_element", input, async () => {
    await context.screenMap.dragElements(input.snapshot_id, input.from_element_id, input.to_element_id, input.button, input.duration_ms);
    return textResult({ dragged: true, observe_again: true });
  }));

  server.registerTool("desktop_read_element_text", {
    description: "Read a live AT-SPI Text range, including offscreen text exposed by the element. Offsets count Unicode characters. Password roles are excluded; no OCR. Requires a retained snapshot.",
    inputSchema: z.object({ snapshot_id: snapshotIdSchema, element_id: elementIdSchema,
      start_offset: z.number().int().min(0).max(2_000_000_000).default(0), length: z.number().int().min(1).max(100_000).default(10_000) }),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_read_element_text", input, async () => textResult({
    text: await context.screenMap.readElementText(input.snapshot_id, input.element_id, input.start_offset, input.start_offset + input.length),
    start_offset: input.start_offset, requested_length: input.length,
  })));

  server.registerTool("desktop_read_window_text", {
    description: "Traverse window accessibility nodes and read published Text content without visibility/geometry filtering. Includes offscreen content when exposed by the app. Bounded scan; partial=true means content may be missing. No OCR; password roles excluded.",
    inputSchema: z.object({ window_id: windowIdSchema, max_characters: z.number().int().min(1).max(100_000).default(20_000) }),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_read_window_text", input, async () => textResult(await context.screenMap.readWindowText(input.window_id, input.max_characters))));
  server.registerTool("desktop_get_element_actions", {
    description: "List live AT-SPI semantic action names for an element. Does not invoke an action.",
    inputSchema: z.object({ snapshot_id: snapshotIdSchema, element_id: elementIdSchema }),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_get_element_actions", input, async () => textResult({ actions: await context.screenMap.getElementActions(input.snapshot_id, input.element_id) })));

  server.registerTool("desktop_perform_element_action", {
    description: "Invoke one explicitly named AT-SPI action after shared preconditions and human approval. No physical-click fallback or automatic retry exists. Requires session_id and a new request_id; duplicate IDs replay the recorded result.",
    inputSchema: withActionFields(z.object({ snapshot_id: snapshotIdSchema, element_id: elementIdSchema, action_name: z.string().min(1).max(256) })),
  }, async (input, extra) => executeTool(withToolRequest(context, extra), "desktop_perform_element_action", input, async () => textResult(await context.screenMap.performElementAction(input.snapshot_id, input.element_id, input.action_name))));

}
