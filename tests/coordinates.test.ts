import { describe, expect, it } from "vitest";
import { windowRelativePoint } from "../src/backend/DesktopBackend.js";
import { x11Geometry } from "../src/backend/X11Backend.js";

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

  it("serializes negative X11 geometry without a malformed plus-minus", () => {
    expect(x11Geometry({ x: -1920, y: -10, width: 800, height: 600 })).toBe("800x600-1920-10");
  });
});
