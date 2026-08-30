import { describe, expect, it } from "vitest";
import { ActionGuard } from "../src/safety/ActionGuard.js";

describe("ActionGuard", () => {
  const guard = new ActionGuard();
  it("classifies observation and interaction centrally", () => {
    expect(guard.classify("desktop_screenshot", {})).toBe("read_only");
    expect(guard.classify("desktop_observe_marked", {})).toBe("read_only");
    expect(guard.classify("desktop_get_elements", {})).toBe("read_only");
    expect(guard.classify("desktop_click_element", {})).toBe("interaction");
    expect(guard.classify("desktop_click", {})).toBe("interaction");
  });
  it("identifies a small high-impact shortcut set", () => {
    expect(guard.classify("desktop_key_press", { key: "F4", modifiers: ["Alt"] })).toBe("high_impact");
    expect(guard.classify("desktop_key_press", { key: "Delete", modifiers: ["Ctrl"] })).toBe("high_impact");
    expect(guard.classify("desktop_act", { actions: [{ type: "key", key: "KP_Delete", modifiers: ["Shift"] }] })).toBe("high_impact");
  });

  it("treats malformed raw input as ordinary interaction instead of throwing", () => {
    expect(guard.classify("desktop_key_press", { key: "F4", modifiers: "Alt" })).toBe("interaction");
    expect(guard.classify("desktop_act", { actions: "not an array" })).toBe("interaction");
  });
});
