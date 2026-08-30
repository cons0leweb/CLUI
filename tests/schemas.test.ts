import { describe, expect, it } from "vitest";
import { actSchema, screenshotSchema, windowPointSchema } from "../src/tools/schemas.js";

describe("tool schemas", () => {
  it("requires window_id for a window screenshot", () => {
    expect(screenshotSchema.safeParse({ mode: "window" }).success).toBe(false);
    expect(screenshotSchema.safeParse({ mode: "window", window_id: "0x123" }).success).toBe(true);
  });

  it("validates region dimensions", () => {
    expect(screenshotSchema.safeParse({ mode: "region", region: { x: 0, y: 0, width: 0, height: 10 } }).success).toBe(false);
  });

  it("limits combined actions to 20", () => {
    const actions = Array.from({ length: 21 }, () => ({ type: "wait" as const, milliseconds: 1 }));
    expect(actSchema.safeParse({ actions }).success).toBe(false);
  });

  it("requires a valid focus selector inside a batch", () => {
    expect(actSchema.safeParse({ actions: [{ type: "focus" }] }).success).toBe(false);
    expect(actSchema.safeParse({ actions: [{ type: "focus", title: "Minecraft" }] }).success).toBe(true);
  });

  it("requires a region for region screenshots", () => {
    expect(screenshotSchema.safeParse({ mode: "region" }).success).toBe(false);
    expect(screenshotSchema.safeParse({ mode: "region", region: { x: 0, y: 0, width: 10, height: 10 } }).success).toBe(true);
  });

  it("applies normalized defaults and validates ids", () => {
    const parsed = windowPointSchema.parse({ window_id: "123", x: 0.5, y: 0.5 });
    expect(parsed.normalized).toBe(false);
    expect(() => windowPointSchema.parse({ window_id: "$(bad)", x: 1, y: 1 })).toThrow();
  });
});
