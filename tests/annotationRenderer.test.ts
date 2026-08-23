import { describe, expect, it, vi } from "vitest";
import { AnnotationRenderer, annotationArguments, mapAnnotationBoxes } from "../src/screenmap/AnnotationRenderer.js";
import type { ScreenElement } from "../src/types/screenMap.js";
import { testWindow } from "./screenMapFixtures.js";

const element: ScreenElement = {
  id: 12, role: "button", label: "Save", description: null,
  x: 200, y: 150, width: 100, height: 40,
  visible: true, enabled: true, focused: false, focusable: true, clickable: true, editable: false, selected: false, source: "atspi",
};

describe("annotation renderer", () => {
  it("maps global boxes to a downscaled window screenshot", () => {
    const boxes = mapAnnotationBoxes([element], testWindow, { png: Buffer.alloc(0), width: 400, height: 300, source: "window", backend: "fake" });
    expect(boxes).toEqual([{ id: 12, x: 50, y: 50, width: 50, height: 20 }]);
  });

  it("draws monochrome boxes and numeric labels through fixed ImageMagick arguments", async () => {
    const runner = vi.fn(async () => Buffer.from("annotated"));
    const renderer = new AnnotationRenderer(runner);
    const result = await renderer.render({ png: Buffer.from("raw"), width: 800, height: 600, source: "window", backend: "fake" }, testWindow, [element]);
    expect(result.png.toString()).toBe("annotated");
    const args = runner.mock.calls[0]![0];
    expect(args).toContain("[12]");
    expect(args).toEqual(annotationArguments(mapAnnotationBoxes([element], testWindow, { png: Buffer.alloc(0), width: 800, height: 600, source: "window", backend: "fake" })));
  });
});
