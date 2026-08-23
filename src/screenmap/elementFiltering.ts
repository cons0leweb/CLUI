import type { Geometry, WindowInfo } from "../types/desktop.js";
import type { AccessibilityElement } from "../types/screenMap.js";
import { rankElements } from "./elementRanking.js";

const USEFUL_ROLES = new Set([
  "push button", "button", "link", "text", "entry", "password text", "check box", "radio button",
  "page tab", "page tab list", "menu", "menu item", "check menu item", "radio menu item", "heading", "header",
  "list item", "tree item", "combo box", "spin button", "slider", "toggle button", "table cell", "paragraph",
  "label", "static", "document web", "document frame",
]);

function intersection(a: Geometry, b: Geometry): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function nearlySameBox(a: Geometry, b: Geometry): boolean {
  const shared = intersection(a, b);
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return smaller > 0 && shared / smaller > 0.96;
}

export interface FilterElementsOptions {
  includeNonInteractive?: boolean;
  maxElements?: number;
}

export function filterElements(elements: AccessibilityElement[], window: WindowInfo, options: FilterElementsOptions = {}): AccessibilityElement[] {
  const includeNonInteractive = options.includeNonInteractive ?? false;
  const candidates = rankElements(elements.filter((element) => {
    if (!element.visible || element.width <= 0 || element.height <= 0) return false;
    if (intersection(element, window) <= 0) return false;
    if (element.clickable || element.focusable || element.editable || element.focused || element.selected) return true;
    const meaningful = Boolean(element.label?.trim()) && USEFUL_ROLES.has(element.role.toLocaleLowerCase());
    return meaningful || (includeNonInteractive && Boolean(element.label?.trim()));
  }));

  const deduplicated: AccessibilityElement[] = [];
  for (const candidate of candidates) {
    const duplicate = deduplicated.some((kept) => {
      if (!nearlySameBox(candidate, kept)) return false;
      const sameLabel = candidate.label === kept.label;
      const candidateWeaker = !candidate.clickable && !candidate.editable && !candidate.focusable;
      return sameLabel || candidateWeaker;
    });
    if (!duplicate) deduplicated.push(candidate);
    if (deduplicated.length >= (options.maxElements ?? 150)) break;
  }
  return deduplicated;
}
