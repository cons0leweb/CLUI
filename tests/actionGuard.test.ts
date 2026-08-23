import { describe, expect, it } from "vitest";
import { ActionGuard } from "../src/safety/ActionGuard.js";

describe("ActionGuard", () => {
  const guard = new ActionGuard();
  it("classifies observation and interaction centrally", () => {
    expect(guard.classify("desktop_screenshot", {})).toBe("read_only");
    expect(guard.classify("desktop_click", {})).toBe("interaction");
  });
  it("identifies a small high-impact shortcut set", () => {
    expect(guard.classify("desktop_key_press", { key: "F4", modifiers: ["Alt"] })).toBe("high_impact");
  });
});
