import type { AccessibilityElement } from "../types/screenMap.js";

const HEADING_ROLES = new Set(["heading", "header"]);
const GENERIC_ROLES = new Set(["panel", "section", "filler", "unknown", "redundant object", "viewport"]);

export function rankElement(element: AccessibilityElement): number {
  const area = Math.max(0, element.width * element.height);
  let score = 0;
  if (element.clickable || element.focusable) score += 100;
  if (element.editable) score += 85;
  if (element.label) score += 35;
  if (element.focused) score += 30;
  if (element.selected) score += 25;
  if (HEADING_ROLES.has(element.role.toLocaleLowerCase())) score += 24;
  if (element.enabled) score += 8;
  if (element.visible) score += 10;
  score += Math.min(20, Math.log2(Math.max(1, area)));
  if (GENERIC_ROLES.has(element.role.toLocaleLowerCase())) score -= 60;
  if (!element.label) score -= 25;
  if (element.width < 4 || element.height < 4) score -= 80;
  return score;
}

export function rankElements(elements: AccessibilityElement[]): AccessibilityElement[] {
  return elements
    .map((element, index) => ({ element, index, score: rankElement(element) }))
    .sort((a, b) => b.score - a.score || a.element.y - b.element.y || a.element.x - b.element.x || a.index - b.index)
    .map(({ element }) => element);
}
