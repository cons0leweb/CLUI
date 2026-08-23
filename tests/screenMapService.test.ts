import { describe, expect, it } from "vitest";
import { AnnotationRenderer } from "../src/screenmap/AnnotationRenderer.js";
import { elementClickPoint, ScreenMapService, StaleSnapshotError } from "../src/screenmap/ScreenMapService.js";
import { SnapshotCache } from "../src/screenmap/SnapshotCache.js";
import type { ScreenElement } from "../src/types/screenMap.js";
import { accessibilityElement, FakeAccessibility, FakeDesktop } from "./screenMapFixtures.js";

const renderer = new AnnotationRenderer(async (_args, input) => input);

describe("ScreenMapService", () => {
  it("creates an immutable snapshot with per-snapshot element ids", async () => {
    const service = new ScreenMapService(new FakeDesktop(), new FakeAccessibility(), new SnapshotCache(), renderer);
    const snapshot = await service.observe({ activeWindow: true });
    expect(snapshot.snapshotId).toMatch(/^[0-9a-f-]{36}$/);
    expect(snapshot.screenMapAvailable).toBe(true);
    expect(snapshot.annotatedScreenshotAvailable).toBe(true);
    expect(snapshot.elements[0]?.id).toBe(1);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.elements)).toBe(true);
  });

  it("returns a raw screenshot fallback for an empty accessibility tree", async () => {
    const service = new ScreenMapService(new FakeDesktop(), new FakeAccessibility([]), new SnapshotCache(), renderer);
    const snapshot = await service.observe({ activeWindow: true });
    expect(snapshot.screenMapAvailable).toBe(false);
    expect(snapshot.elements).toEqual([]);
    expect(snapshot.reason).toMatch(/no usable AT-SPI/i);
    expect(snapshot.screenshot.png.toString()).toBe("png");
  });

  it("refuses a click when window geometry changed", async () => {
    const desktop = new FakeDesktop();
    const service = new ScreenMapService(desktop, new FakeAccessibility(), new SnapshotCache(), renderer);
    const snapshot = await service.observe({ activeWindow: true });
    desktop.window = { ...desktop.window, x: desktop.window.x + 100 };
    await expect(service.clickElement(snapshot.snapshotId, 1, "left")).rejects.toBeInstanceOf(StaleSnapshotError);
    expect(desktop.clicks).toBe(0);
  });

  it("refuses a click when the accessibility element moved after scrolling", async () => {
    const desktop = new FakeDesktop();
    const accessibility = new FakeAccessibility();
    const service = new ScreenMapService(desktop, accessibility, new SnapshotCache(), renderer);
    const snapshot = await service.observe({ activeWindow: true });
    accessibility.elements = [accessibilityElement({ y: 180 })];
    await expect(service.clickElement(snapshot.snapshotId, 1, "left")).rejects.toBeInstanceOf(StaleSnapshotError);
    expect(desktop.clicks).toBe(0);
  });

  it("moves to the element center before clicking", async () => {
    const desktop = new FakeDesktop();
    const service = new ScreenMapService(desktop, new FakeAccessibility(), new SnapshotCache(), renderer);
    const snapshot = await service.observe({ activeWindow: true });
    await service.clickElement(snapshot.snapshotId, 1, "left");
    expect(desktop.moves).toEqual([{ x: 170, y: 95 }]);
    expect(desktop.clicks).toBe(1);
  });
});

describe("elementClickPoint", () => {
  const element = { id: 1, x: 10, y: 20, width: 11, height: 21 } as ScreenElement;
  it("calculates center and normalized custom positions", () => {
    expect(elementClickPoint(element)).toEqual({ x: 15, y: 30 });
    expect(elementClickPoint(element, { type: "custom", x: 1, y: 1 })).toEqual({ x: 20, y: 40 });
  });
});
