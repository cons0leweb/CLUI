import { describe, expect, it } from "vitest";
import { summarizeToolInput } from "../src/logging.js";
import { filterSnapshotElements, observeMarkedSchema } from "../src/tools/screenMapTools.js";
import type { ScreenElement } from "../src/types/screenMap.js";

const elements: ScreenElement[] = [
  { id: 1, role: "heading", label: "Security", description: null, x: 0, y: 0, width: 100, height: 20, visible: true, enabled: true, focused: false, focusable: false, clickable: false, editable: false, selected: false, source: "atspi" },
  { id: 2, role: "entry", label: "Address", description: null, x: 0, y: 30, width: 100, height: 20, visible: true, enabled: true, focused: false, focusable: true, clickable: false, editable: true, selected: false, source: "atspi" },
];

describe("ScreenMap tool helpers", () => {
  it("filters cached elements by role, label, and interaction", () => {
    expect(filterSnapshotElements(elements, { role: "heading" })).toEqual([elements[0]]);
    expect(filterSnapshotElements(elements, { labelContains: "CUR" })).toEqual([elements[0]]);
    expect(filterSnapshotElements(elements, { interactiveOnly: true })).toEqual([elements[1]]);
  });

  it("validates a single window selector and max element limit", () => {
    expect(observeMarkedSchema.safeParse({ active_window: true }).success).toBe(true);
    expect(observeMarkedSchema.safeParse({ window_id: "0x123" }).success).toBe(true);
    expect(observeMarkedSchema.safeParse({ active_window: true, window_id: "0x123" }).success).toBe(false);
    expect(observeMarkedSchema.safeParse({ active_window: false, title: "Firefox", max_elements: 501 }).success).toBe(false);
  });

  it("does not put accessibility search text into structured logs", () => {
    expect(summarizeToolInput("desktop_get_elements", { snapshot_id: "id", label_contains: "secret value" })).toEqual({ snapshot_id: "id" });
    expect(summarizeToolInput("desktop_observe_marked", { title: "Private document", class: "Firefox" })).toEqual({});
  });
});
