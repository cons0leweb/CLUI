export type ActionClass = "read_only" | "interaction" | "high_impact";

const READ_ONLY = new Set([
  "desktop_get_active_window", "desktop_list_windows", "desktop_find_window", "desktop_get_window_info",
  "desktop_screenshot", "desktop_get_mouse_position", "desktop_get_screen_info", "desktop_observe", "desktop_get_capabilities",
  "desktop_observe_marked", "desktop_get_elements", "desktop_element_info",
]);

const HIGH_IMPACT_KEYS = new Set(["Delete", "KP_Delete"]);
const HIGH_IMPACT_DELETE_MODIFIERS = new Set(["Shift", "Ctrl"]);

interface KeyInput {
  key?: unknown;
  modifiers?: unknown;
}

function hasModifier(input: KeyInput, modifier: string): boolean {
  return Array.isArray(input.modifiers) && input.modifiers.includes(modifier);
}

function hasAnyModifier(input: KeyInput, modifiers: ReadonlySet<string>): boolean {
  return Array.isArray(input.modifiers) && input.modifiers.some((modifier) => typeof modifier === "string" && modifiers.has(modifier));
}

export class ActionGuard {
  classify(toolName: string, input: unknown): ActionClass {
    if (READ_ONLY.has(toolName)) return "read_only";
    if (toolName === "desktop_key_press" && input && typeof input === "object") {
      const value = input as KeyInput;
      if (typeof value.key !== "string") return "interaction";
      if (HIGH_IMPACT_KEYS.has(value.key) && hasAnyModifier(value, HIGH_IMPACT_DELETE_MODIFIERS)) return "high_impact";
      if (value.key === "F4" && hasModifier(value, "Alt")) return "high_impact";
    }
    if (toolName === "desktop_act" && input && typeof input === "object") {
      const actions = (input as { actions?: unknown }).actions;
      const hasHighImpactAction = Array.isArray(actions) && actions.some((action) => {
        if (!action || typeof action !== "object") return false;
        if ((action as { type?: unknown }).type !== "key") return false;
        return this.classify("desktop_key_press", action) === "high_impact";
      });
      if (hasHighImpactAction) return "high_impact";
    }
    return "interaction";
  }

  async authorize(_toolName: string, _classification: ActionClass): Promise<void> {
    // Extension point for a future local approval policy. MVP records classification but allows all GUI actions.
  }
}
