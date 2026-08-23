import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ScreenElement } from "../types/screenMap.js";
import type { ToolContext } from "./context.js";
import { executeTool, screenshotResult, textResult } from "./context.js";
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
  }, async (input) => executeTool(context, "desktop_observe_marked", input, async () => {
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
  }, async (input) => executeTool(context, "desktop_get_elements", input, async () => {
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
  }, async (input) => executeTool(context, "desktop_element_info", input, async () => textResult({
    snapshot_id: input.snapshot_id,
    element: context.screenMap.getElement(input.snapshot_id, input.element_id),
  })));

  server.registerTool("desktop_click_element", {
    description: "Click a numbered ScreenMap element after checking snapshot lifetime and current window geometry.",
    inputSchema: z.object({
      snapshot_id: snapshotIdSchema,
      element_id: elementIdSchema,
      button: mouseButtonSchema.default("left"),
      click_position: clickPositionSchema.default({ type: "center" }),
    }),
  }, async (input) => executeTool(context, "desktop_click_element", input, async () => {
    const result = await context.screenMap.clickElement(input.snapshot_id, input.element_id, input.button, input.click_position);
    return textResult({ snapshot_id: input.snapshot_id, element_id: input.element_id, clicked_at: result.point, button: input.button });
  }));

  server.registerTool("desktop_focus_element", {
    description: "Focus a numbered element using AT-SPI Component.GrabFocus, with a checked mouse click fallback.",
    inputSchema: z.object({ snapshot_id: snapshotIdSchema, element_id: elementIdSchema }),
  }, async (input) => executeTool(context, "desktop_focus_element", input, async () => textResult({
    snapshot_id: input.snapshot_id,
    element_id: input.element_id,
    ...(await context.screenMap.focusElement(input.snapshot_id, input.element_id)),
  })));
}
