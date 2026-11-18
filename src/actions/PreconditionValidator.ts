import { normalizeWindowId } from "../backend/x11Parsers.js";
import type { DesktopBackend } from "../backend/DesktopBackend.js";
import type { ScreenMapService } from "../screenmap/ScreenMapService.js";
import { ActionFailure, type ActionStep } from "./types.js";

export class PreconditionValidator {
  constructor(private readonly desktop: DesktopBackend, private readonly screenMap: ScreenMapService) {}
  authorizationInput(step: ActionStep): Record<string, unknown> {
    try {
      const targets = [];
      if (step.input.preconditions?.element) targets.push(step.input.preconditions.element);
      if (step.input.snapshot_id) {
        for (const id of [step.input.element_id, step.input.from_element_id, step.input.to_element_id]) {
          if (typeof id === "number") targets.push({ snapshot_id: step.input.snapshot_id, element_id: id });
        }
      }
      const labels = targets.map((target) => this.screenMap.getElement(target.snapshot_id, target.element_id).label).filter((label): label is string => label !== null);
      return { ...step.input, validated_element_names: labels };
    } catch {
      throw new ActionFailure("precondition_unknown", "authorization_target_unavailable");
    }
  }
  async validate(step: ActionStep): Promise<void> {
    const { name, input } = step;
    const conditions = input.preconditions ?? {};
    let expectedWindow = conditions.active_window_id ?? input.expected_window_id;
    const elements: Array<{ snapshot_id: string; element_id: number; name?: string | undefined }> = [];
    if (conditions.element) elements.push(conditions.element);
    if (typeof input.snapshot_id === "string") {
      for (const id of [input.element_id, input.from_element_id, input.to_element_id]) {
        if (typeof id === "number") elements.push({ snapshot_id: input.snapshot_id, element_id: id });
      }
    }
    try {
      if (conditions.active_window_id && input.expected_window_id && normalizeWindowId(conditions.active_window_id) !== normalizeWindowId(input.expected_window_id)) throw new ActionFailure("precondition_failed", "active_window_condition_conflict", input.expected_window_id, conditions.active_window_id);
      for (const target of elements) {
        const snapshot = this.screenMap.getSnapshot(target.snapshot_id);
        const cached = this.screenMap.getElement(target.snapshot_id, target.element_id);
        const live = await this.screenMap.inspectElement(target.snapshot_id, target.element_id);
        const expectedName = target.name ?? cached.label ?? "";
        if (live.label !== expectedName) throw new ActionFailure("precondition_failed", "element_name_mismatch", expectedName, live.label);
        if (!live.enabled || !live.visible) throw new ActionFailure("precondition_failed", "element_unavailable", { enabled: true, visible: true }, { enabled: live.enabled, visible: live.visible });
        if (live.role !== cached.role) throw new ActionFailure("precondition_failed", "element_role_mismatch", cached.role, live.role);
        const current = await this.desktop.getWindowInfo(snapshot.window.id);
        if (Math.abs(current.x - snapshot.window.x) > 5 || Math.abs(current.y - snapshot.window.y) > 5 || current.width !== snapshot.window.width || current.height !== snapshot.window.height) throw new ActionFailure("precondition_failed", "window_geometry_changed");
        if (Math.abs(live.x - cached.x) > 5 || Math.abs(live.y - cached.y) > 5 || live.width !== cached.width || live.height !== cached.height) throw new ActionFailure("precondition_failed", "element_geometry_changed");
        if (expectedWindow && normalizeWindowId(expectedWindow) !== snapshot.window.id) throw new ActionFailure("precondition_failed", "target_window_conflict", expectedWindow, snapshot.window.id);
        expectedWindow = snapshot.window.id;
      }
      if (typeof input.window_id === "string") {
        await this.desktop.getWindowInfo(input.window_id);
        if (/desktop_(click|drag)/.test(name) && expectedWindow && normalizeWindowId(expectedWindow) !== normalizeWindowId(input.window_id)) throw new ActionFailure("precondition_failed", "target_window_conflict", expectedWindow, input.window_id);
        if (/desktop_(click|move_mouse|drag)/.test(name)) expectedWindow ??= input.window_id;
      }
      const requiresFocus = /desktop_(key_|type_text|scroll|click|mouse_down|mouse_up|drag|perform_element_action)/.test(name);
      if (requiresFocus && !expectedWindow) throw new ActionFailure("precondition_unknown", "expected_window_required");
      if (expectedWindow) {
        const active = await this.desktop.getActiveWindow();
        if (!active) throw new ActionFailure("precondition_unknown", "active_window_unavailable", expectedWindow);
        if (active.id !== normalizeWindowId(expectedWindow)) throw new ActionFailure("precondition_failed", "active_window_mismatch", normalizeWindowId(expectedWindow), active.id);
      }
      if (name === "desktop_perform_element_action") {
        if (typeof input.snapshot_id !== "string" || typeof input.element_id !== "number") throw new ActionFailure("precondition_unknown", "element_target_required");
        const actions = await this.screenMap.getElementActions(input.snapshot_id, input.element_id);
        if (actions.filter((action) => action.name === input.action_name).length !== 1) throw new ActionFailure("precondition_failed", "semantic_action_unavailable", input.action_name);
      }
    } catch (error) {
      if (error instanceof ActionFailure) throw error;
      throw new ActionFailure("precondition_unknown", elements.length ? "accessibility_or_target_unavailable" : "window_state_unavailable");
    }
  }
}
