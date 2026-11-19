import { publishLogEvent } from "./events/VisualEventPublisher.js";
export type LogLevel = "info" | "error";

export function log(level: LogLevel, event: string, fields: object = {}): void {
  publishLogEvent(event, fields);
  process.stderr.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields })}\n`);
}

export function summarizeToolInput(name: string, input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  const safe = { ...(input as Record<string, unknown>) };
  delete safe.preconditions;
  if (name === "desktop_observe_marked") return {};
  if (name === "desktop_get_elements") return typeof safe.snapshot_id === "string" ? { snapshot_id: safe.snapshot_id } : {};
  if (name === "desktop_element_info" || name === "desktop_click_element" || name === "desktop_focus_element") {
    return {
      ...(typeof safe.snapshot_id === "string" ? { snapshot_id: safe.snapshot_id } : {}),
      ...(typeof safe.element_id === "number" ? { element_id: safe.element_id } : {}),
    };
  }
  if ((name === "desktop_type_text" || name === "desktop_write_clipboard") && typeof safe.text === "string") safe.text = { length: safe.text.length };
  if (name === "desktop_act" && Array.isArray(safe.actions)) {
    safe.actions = safe.actions.map((action) => {
      if (!action || typeof action !== "object") return action;
      const copy = { ...(action as Record<string, unknown>) };
      delete copy.preconditions;
      if (typeof copy.text === "string") copy.text = { length: copy.text.length };
      return copy;
    });
  }
  return safe;
}
