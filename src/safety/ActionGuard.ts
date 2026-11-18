import { ActionFailure } from "../actions/types.js";
export type ActionClass = "read_only" | "interaction" | "high_impact";

const READ_ONLY = new Set([
  "desktop_get_active_window", "desktop_list_windows", "desktop_find_window", "desktop_get_window_info",
  "desktop_screenshot", "desktop_get_mouse_position", "desktop_get_screen_info", "desktop_observe", "desktop_get_capabilities",
  "desktop_read_clipboard", "desktop_read_element_text", "desktop_read_window_text", "desktop_list_surfaces",
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

export type ApprovalProvider = (request: { tool: string; input: unknown; signal?: AbortSignal }) => Promise<"approved" | "denied" | "unavailable">;

export class ActionGuard {
  constructor(private readonly approval?: ApprovalProvider) {}
  classify(toolName: string, input: unknown): ActionClass {
    if (toolName === "desktop_control_session" && (input as { action?: string } | null)?.action === "status") return "read_only";
    if (toolName === "desktop_get_element_actions") return "read_only";
    if (toolName === "desktop_perform_element_action" || toolName === "desktop_key_down") return "high_impact";
    const targetNames = input && typeof input === "object" ? (input as { validated_element_names?: unknown }).validated_element_names : null;
    if (Array.isArray(targetNames) && targetNames.some((name) => typeof name === "string" && /delete|remove|erase|format|shutdown|purchase|pay|send|удал|стереть|форматир|оплат|отправ/i.test(name))) return "high_impact";
    if (READ_ONLY.has(toolName)) return "read_only";
    if (toolName === "desktop_key_press" && input && typeof input === "object") {
      const value = input as KeyInput;
      if (typeof value.key !== "string") return "interaction";
      if (/(?:^|\+)(?:F4|Delete|KP_Delete)(?:$|\+)/i.test(value.key)) return "high_impact";
      if (/(?:ctrl|control)(?:_[lr])?\+(?:q|w)/i.test(value.key) || (/^[qw]$/i.test(value.key) && hasModifier(value, "Ctrl"))) return "high_impact";
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

  async authorize(toolName: string, classification: ActionClass, input: unknown = {}, signal?: AbortSignal): Promise<void> {
    if (classification !== "high_impact") return;
    if (!this.approval) throw new ActionFailure("approval_unavailable", "trusted_approval_unavailable");
    let decision: Awaited<ReturnType<ApprovalProvider>>;
    try { decision = await this.approval({ tool: toolName, input, ...(signal ? { signal } : {}) }); }
    catch { decision = "unavailable"; }
    if (decision !== "approved") throw new ActionFailure(decision === "denied" ? "approval_denied" : "approval_unavailable", decision === "denied" ? "human_declined" : "trusted_approval_unavailable");
  }
}
