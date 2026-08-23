import { describe, expect, it } from "vitest";
import { filterElements } from "../src/screenmap/elementFiltering.js";
import { rankElement } from "../src/screenmap/elementRanking.js";
import { accessibilityElement, testWindow } from "./screenMapFixtures.js";

describe("ScreenMap filtering and ranking", () => {
  it("drops invisible, offscreen, zero-size, and unnamed containers", () => {
    const kept = accessibilityElement();
    const result = filterElements([
      kept,
      accessibilityElement({ visible: false }),
      accessibilityElement({ x: 5_000 }),
      accessibilityElement({ width: 0 }),
      accessibilityElement({ role: "panel", label: null, clickable: false, focusable: false }),
    ], testWindow);
    expect(result).toEqual([kept]);
  });

  it("ranks named interactive elements above generic containers", () => {
    expect(rankElement(accessibilityElement())).toBeGreaterThan(rankElement(accessibilityElement({ role: "panel", label: null, clickable: false, focusable: false })));
  });

  it("removes redundant elements with the same box and label", () => {
    expect(filterElements([accessibilityElement(), accessibilityElement()], testWindow)).toHaveLength(1);
  });
});
