import { describe, expect, it } from "vitest";
import { windowRelativePoint } from "../src/backend/DesktopBackend.js";

describe("windowRelativePoint", () => {
  const window = { x: 100, y: 50, width: 801, height: 601 };

  it("converts normalized center coordinates", () => {
    expect(windowRelativePoint(window, 0.5, 0.5, true)).toEqual({ x: 500, y: 350 });
  });

  it("converts pixel coordinates", () => {
    expect(windowRelativePoint(window, 10, 20, false)).toEqual({ x: 110, y: 70 });
  });

  it("rejects coordinates outside the selected coordinate space", () => {
    expect(() => windowRelativePoint(window, 1.1, 0.5, true)).toThrow(/between 0 and 1/);
    expect(() => windowRelativePoint(window, 900, 20, false)).toThrow(/outside/);
  });
});
