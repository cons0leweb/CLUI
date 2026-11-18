import { ActionFailure } from "../actions/types.js";
import { randomUUID } from "node:crypto";
import type { AccessibilityBackend } from "../accessibility/AccessibilityBackend.js";
import type { DesktopBackend } from "../backend/DesktopBackend.js";
import type { Geometry, MouseButton, Point, WindowInfo } from "../types/desktop.js";
import type { AccessibilityTarget, ScreenElement, ScreenMapCapabilities, ScreenMapSnapshot } from "../types/screenMap.js";
import { log } from "../logging.js";
import { AnnotationRenderer } from "./AnnotationRenderer.js";
import { filterElements } from "./elementFiltering.js";
import { SnapshotCache } from "./SnapshotCache.js";

export class StaleSnapshotError extends ActionFailure {
  constructor(message: string) {
    super("precondition_failed", "stale_snapshot");
    this.message = `${message}; call desktop_observe_marked again before interacting`;
    this.name = "StaleSnapshotError";
  }
}

export interface ObserveMarkedOptions {
  windowId?: string;
  title?: string;
  className?: string;
  activeWindow?: boolean;
  maxWidth?: number;
  maxHeight?: number;
  includeNonInteractive?: boolean;
  maxElements?: number;
}

export type ClickPosition =
  | { type: "center" }
  | { type: "top_left" }
  | { type: "custom"; x: number; y: number };

function readonlyMap<K, V>(source: Map<K, V>): ReadonlyMap<K, V> {
  const snapshot = new Map(source);
  return Object.freeze({
    get size() { return snapshot.size; },
    get: snapshot.get.bind(snapshot),
    has: snapshot.has.bind(snapshot),
    forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown) {
      snapshot.forEach((value, key) => callback.call(thisArg, value, key, this));
    },
    entries: snapshot.entries.bind(snapshot),
    keys: snapshot.keys.bind(snapshot),
    values: snapshot.values.bind(snapshot),
    [Symbol.iterator]: snapshot[Symbol.iterator].bind(snapshot),
    [Symbol.toStringTag]: "Map",
  });
}

function geometryChanged(before: WindowInfo, after: WindowInfo): boolean {
  const positionDelta = Math.max(Math.abs(before.x - after.x), Math.abs(before.y - after.y));
  const widthDelta = Math.abs(before.width - after.width) / Math.max(1, before.width);
  const heightDelta = Math.abs(before.height - after.height) / Math.max(1, before.height);
  return positionDelta > 10 || widthDelta > 0.05 || heightDelta > 0.05;
}

export function elementClickPoint(element: ScreenElement, position: ClickPosition = { type: "center" }): Point {
  if (element.width <= 0 || element.height <= 0) throw new Error(`Element ${element.id} has invalid geometry`);
  if (position.type === "custom") {
    if (position.x < 0 || position.x > 1 || position.y < 0 || position.y > 1) throw new RangeError("Custom element coordinates must be between 0 and 1");
    return {
      x: Math.round(element.x + position.x * Math.max(0, element.width - 1)),
      y: Math.round(element.y + position.y * Math.max(0, element.height - 1)),
    };
  }
  if (position.type === "top_left") return { x: element.x + Math.min(3, element.width - 1), y: element.y + Math.min(3, element.height - 1) };
  return { x: Math.round(element.x + (element.width - 1) / 2), y: Math.round(element.y + (element.height - 1) / 2) };
}

export class ScreenMapService {
  constructor(
    private readonly desktop: DesktopBackend,
    private readonly accessibility: AccessibilityBackend,
    private readonly cache = new SnapshotCache(),
    private readonly renderer = new AnnotationRenderer(),
  ) {}

  async getCapabilities(): Promise<ScreenMapCapabilities> {
    const availability = await this.accessibility.getAvailability();
    const annotated = Boolean(this.desktop.capabilities.executables.convert);
    return {
      canScreenMap: availability.available,
      accessibilityBackend: availability.available ? availability.backend : null,
      atSpiAvailable: availability.available && availability.backend === "atspi",
      annotatedScreenshotAvailable: annotated,
      reason: availability.available ? (annotated ? null : "ImageMagick 'convert' is unavailable") : availability.reason,
    };
  }

  async observe(options: ObserveMarkedOptions): Promise<ScreenMapSnapshot> {
    const started = performance.now();
    const window = await this.resolveWindow(options);
    let rawElements: Awaited<ReturnType<AccessibilityBackend["getElementsForWindow"]>>["elements"] = [];
    let reason: string | null = null;
    try {
      const scan = await this.accessibility.getElementsForWindow(window);
      rawElements = scan.elements;
      if (scan.partial) reason = `Accessibility scan was partial: ${scan.failedNodes} element nodes could not be read`;
      if (rawElements.length === 0) reason = "The application published no usable AT-SPI elements for this window";
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
    const filtered = filterElements(rawElements, window, {
      ...(options.includeNonInteractive !== undefined ? { includeNonInteractive: options.includeNonInteractive } : {}),
      ...(options.maxElements !== undefined ? { maxElements: options.maxElements } : {}),
    });
    if (rawElements.length > 0 && filtered.length === 0) reason = "The accessibility tree contained no useful visible elements";

    const screenshot = await this.desktop.screenshot({
      mode: "window",
      windowId: window.id,
      ...(options.maxWidth ? { maxWidth: options.maxWidth } : {}),
      ...(options.maxHeight ? { maxHeight: options.maxHeight } : {}),
    });
    try {
      const afterScreenshot = await this.desktop.getWindowInfo(window.id);
      if (geometryChanged(window, afterScreenshot)) {
        throw new StaleSnapshotError("Window geometry changed while the ScreenMap snapshot was being captured");
      }
    } catch (error) {
      if (error instanceof StaleSnapshotError) throw error;
      throw new Error(`Unable to verify ScreenMap capture consistency: ${error instanceof Error ? error.message : String(error)}`);
    }

    const targets = new Map<number, AccessibilityTarget>();
    const elements = filtered.map((element, index): ScreenElement => {
      const id = index + 1;
      targets.set(id, Object.freeze({ ...element.target }));
      const { target: _target, ...publicElement } = element;
      return Object.freeze({ id, source: "atspi", ...publicElement });
    });
    let annotated = screenshot;
    let annotatedScreenshotAvailable = false;
    if (elements.length > 0 && this.desktop.capabilities.executables.convert) {
      try {
        annotated = await this.renderer.render(screenshot, window, elements);
        annotatedScreenshotAvailable = true;
      }
      catch (error) { reason = `Accessibility elements were found, but annotation failed: ${error instanceof Error ? error.message : String(error)}`; }
    } else if (elements.length > 0) {
      reason = "Accessibility elements were found, but ImageMagick 'convert' is unavailable";
    }

    const createdAt = Date.now();
    const snapshot: ScreenMapSnapshot = Object.freeze({
      snapshotId: randomUUID(),
      createdAt,
      expiresAt: createdAt + this.cache.ttlMs,
      window: Object.freeze({ ...window }),
      screenshot: annotated,
      elements: Object.freeze(elements),
      targets: readonlyMap(targets),
      screenMapAvailable: elements.length > 0,
      annotatedScreenshotAvailable,
      reason,
    });
    this.cache.put(snapshot);
    log("info", "screen_map_snapshot", {
      snapshot_id: snapshot.snapshotId,
      element_count: snapshot.elements.length,
      backend: this.accessibility.name,
      available: snapshot.screenMapAvailable,
      duration_ms: Math.round(performance.now() - started),
    });
    return snapshot;
  }

  getSnapshot(snapshotId: string): ScreenMapSnapshot {
    return this.cache.get(snapshotId);
  }

  getElement(snapshotId: string, elementId: number): ScreenElement {
    return this.getSnapshotElement(snapshotId, elementId).element;
  }

  async clickElement(snapshotId: string, elementId: number, button: MouseButton, position?: ClickPosition): Promise<{ point: Point; element: ScreenElement }> {
    const { snapshot, element } = this.getSnapshotElement(snapshotId, elementId);
    await this.assertFreshGeometry(snapshot, element);
    const point = elementClickPoint(element, position);
    this.assertPointInWindow(point, snapshot.window);
    await this.desktop.moveMouse(point.x, point.y);
    await this.desktop.clickMouse(button);
    return { point, element };
  }

  async focusElement(snapshotId: string, elementId: number): Promise<{ method: "accessibility_action" | "mouse_fallback"; point?: Point }> {
    const { snapshot, element } = this.getSnapshotElement(snapshotId, elementId);
    await this.assertFreshGeometry(snapshot, element);
    const target = snapshot.targets.get(elementId);
    if (target) {
      if (await this.accessibility.focusElement(target)) return { method: "accessibility_action" };
      throw new Error("Accessibility focus did not acknowledge success; no click fallback was attempted");
    }
    const point = elementClickPoint(element);
    this.assertPointInWindow(point, snapshot.window);
    await this.desktop.moveMouse(point.x, point.y);
    await this.desktop.clickMouse("left");
    return { method: "mouse_fallback", point };
  }

  async scrollElement(snapshotId: string, elementId: number, deltaX: number, deltaY: number): Promise<void> {
    const { snapshot, element } = this.getSnapshotElement(snapshotId, elementId);
    await this.assertFreshGeometry(snapshot, element);
    const point = elementClickPoint(element);
    this.assertPointInWindow(point, snapshot.window);
    await this.desktop.moveMouse(point.x, point.y);
    await this.desktop.scroll(deltaX, deltaY);
  }

  async dragElements(snapshotId: string, fromId: number, toId: number, button: MouseButton, durationMs: number): Promise<void> {
    const { snapshot, element: from } = this.getSnapshotElement(snapshotId, fromId);
    const { element: to } = this.getSnapshotElement(snapshotId, toId);
    await this.assertFreshGeometry(snapshot, from);
    await this.assertFreshGeometry(snapshot, to);
    const start = elementClickPoint(from);
    const end = elementClickPoint(to);
    this.assertPointInWindow(start, snapshot.window);
    this.assertPointInWindow(end, snapshot.window);
    await this.desktop.drag(start, end, button, durationMs);
  }

  async inspectElement(snapshotId: string, elementId: number) {
    const { snapshot } = this.getSnapshotElement(snapshotId, elementId);
    const target = snapshot.targets.get(elementId);
    if (!target) throw new Error("Element target unavailable");
    return this.accessibility.getElementState(target);
  }

  async getElementActions(snapshotId: string, elementId: number) {
    const { snapshot } = this.getSnapshotElement(snapshotId, elementId);
    const target = snapshot.targets.get(elementId);
    if (!target) throw new Error("Element target unavailable");
    return this.accessibility.getActions(target);
  }

  async performElementAction(snapshotId: string, elementId: number, actionName: string) {
    const { snapshot } = this.getSnapshotElement(snapshotId, elementId);
    const target = snapshot.targets.get(elementId);
    if (!target) throw new Error("Element target unavailable");
    if (!await this.accessibility.performAction(target, actionName)) throw new Error("Semantic action did not acknowledge success");
    return { method: "accessibility_action", action: actionName };
  }

  async readElementText(snapshotId: string, elementId: number, start: number, end: number): Promise<string> {
    const { snapshot, element } = this.getSnapshotElement(snapshotId, elementId);
    if (/password/i.test(element.role)) throw new Error("Password text is not exposed");
    const target = snapshot.targets.get(elementId);
    if (!target) throw new Error("Element has no accessibility target");
    return this.accessibility.readText(target, start, end);
  }

  async readWindowText(windowId: string, maxCharacters: number) {
    return this.accessibility.readWindowText(await this.desktop.getWindowInfo(windowId), maxCharacters);
  }

  private getSnapshotElement(snapshotId: string, elementId: number): { snapshot: ScreenMapSnapshot; element: ScreenElement } {
    const snapshot = this.cache.get(snapshotId);
    const element = snapshot.elements.find(({ id }) => id === elementId);
    if (!element) throw new Error(`Element ${elementId} does not exist in ScreenMap snapshot '${snapshotId}'`);
    return { snapshot, element };
  }

  private async assertFreshGeometry(snapshot: ScreenMapSnapshot, element: ScreenElement): Promise<void> {
    try {
    const current = await this.desktop.getWindowInfo(snapshot.window.id);
    if (geometryChanged(snapshot.window, current)) throw new StaleSnapshotError(`Window ${snapshot.window.id} geometry changed`);
    const active = await this.desktop.getActiveWindow();
    if (!active) throw new ActionFailure("precondition_unknown", "active_window_unavailable");
    if (active.id !== snapshot.window.id) throw new StaleSnapshotError(`Window ${snapshot.window.id} is no longer active`);
    const target = snapshot.targets.get(element.id);
    if (target) {
      const currentElement = await this.accessibility.getElementGeometry(target);
      if (!currentElement) throw new StaleSnapshotError(`Element ${element.id} no longer has usable geometry`);
      const positionDelta = Math.max(Math.abs(element.x - currentElement.x), Math.abs(element.y - currentElement.y));
      const sizeDelta = Math.max(
        Math.abs(element.width - currentElement.width) / Math.max(1, element.width),
        Math.abs(element.height - currentElement.height) / Math.max(1, element.height),
      );
      if (positionDelta > 5 || sizeDelta > 0.05) throw new StaleSnapshotError(`Element ${element.id} moved or changed size`);
    }
    } catch (error) {
      if (error instanceof ActionFailure) throw error;
      throw new ActionFailure("precondition_unknown", "target_geometry_unavailable");
    }
  }

  private assertPointInWindow(point: Point, window: WindowInfo): void {
    if (point.x < window.x || point.y < window.y || point.x >= window.x + window.width || point.y >= window.y + window.height) {
      throw new StaleSnapshotError("Element coordinates are outside the captured window");
    }
  }

  private async resolveWindow(options: ObserveMarkedOptions): Promise<WindowInfo> {
    if (options.windowId) return this.desktop.getWindowInfo(options.windowId);
    if (options.title || options.className) {
      const title = options.title?.toLocaleLowerCase();
      const className = options.className?.toLocaleLowerCase();
      const matches = (await this.desktop.listWindows()).filter((window) =>
        (!title || window.title.toLocaleLowerCase().includes(title)) &&
        (!className || (window.class ?? "").toLocaleLowerCase().includes(className)));
      if (matches.length === 0) throw new Error("No visible window matched the ScreenMap title/class query");
      return matches[0]!;
    }
    const active = await this.desktop.getActiveWindow();
    if (!active) throw new Error("There is no active X11 window");
    return active;
  }
}
