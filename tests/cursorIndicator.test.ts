import { afterEach, describe, expect, it, vi } from "vitest";
import { CursorIndicator } from "../src/indicator/CursorIndicator.js";
import { executeTool } from "../src/tools/context.js";
import { ActionGuard } from "../src/safety/ActionGuard.js";
import { ScreenMapService } from "../src/screenmap/ScreenMapService.js";
import { FakeDesktop, FakeAccessibility } from "./screenMapFixtures.js";

function fixture() {
  const display = { available: true, send: vi.fn(), close: vi.fn(async () => {}) };
  const indicator = new CursorIndicator(display);
  return { display, indicator };
}
afterEach(() => vi.useRealTimers());

describe("cursor indicator lifecycle", () => {
  it("keeps the ring during session gaps, then expires at the requested deadline", () => {
    vi.useFakeTimers();
    const { display, indicator } = fixture();
    indicator.beginSession(10_000);
    vi.advanceTimersByTime(9_999);
    expect(indicator.status().session_active).toBe(true);
    expect(display.send).toHaveBeenLastCalledWith("show", expect.any(String));
    vi.advanceTimersByTime(1);
    expect(indicator.status().session_active).toBe(false);
    expect(display.send).toHaveBeenLastCalledWith("hide");
  });

  it("accounts for overlapping actions and only hides after the last finishes", () => {
    vi.useFakeTimers();
    const { display, indicator } = fixture();
    const first = indicator.beginAction();
    const second = indicator.beginAction();
    first(); first();
    vi.advanceTimersByTime(4_000);
    expect(indicator.status().active_actions).toBe(1);
    expect(display.send).toHaveBeenLastCalledWith("show", expect.any(String));
    second();
    vi.advanceTimersByTime(3_000);
    expect(display.send).toHaveBeenLastCalledWith("hide");
  });

  it("ends sessions immediately, but does not hide a running action", () => {
    vi.useFakeTimers();
    const { display, indicator } = fixture();
    indicator.beginSession(60_000);
    const finish = indicator.beginAction();
    indicator.endSession();
    expect(display.send).toHaveBeenLastCalledWith("show", expect.any(String));
    finish();
    indicator.endSession();
    expect(display.send).toHaveBeenLastCalledWith("hide");
  });

  it("closes the helper and clears all heartbeat timers", async () => {
    vi.useFakeTimers();
    const { display, indicator } = fixture();
    const finish = indicator.beginAction();
    await indicator.close();
    const count = display.send.mock.calls.length;
    finish(); indicator.pulse(); indicator.beginSession(5_000);
    vi.advanceTimersByTime(60_000);
    expect(display.send).toHaveBeenCalledTimes(count);
    expect(display.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not mark read-only observations as interaction and releases after errors", async () => {
    vi.useFakeTimers();
    const { display, indicator } = fixture();
    const backend = new FakeDesktop();
    const context = { backend, indicator, guard: new ActionGuard(), screenMap: new ScreenMapService(backend, new FakeAccessibility()) };
    await executeTool(context, "desktop_screenshot", {}, async () => "image");
    expect(display.send).not.toHaveBeenCalled();
    await expect(executeTool(context, "desktop_click", {}, async () => { throw new Error("failed"); })).rejects.toThrow("failed");
    expect(indicator.status().active_actions).toBe(0);
    vi.advanceTimersByTime(3_000);
    expect(display.send).toHaveBeenLastCalledWith("hide");
  });
});
