import type { AccessibilityBackend } from "../src/accessibility/AccessibilityBackend.js";
import type { DesktopBackend } from "../src/backend/DesktopBackend.js";
import type { Capabilities, WindowInfo } from "../src/types/desktop.js";
import type { AccessibilityElement } from "../src/types/screenMap.js";

export const testWindow: WindowInfo = {
  id: "0x123", title: "Test window", class: "Test", instance: "test", pid: 42,
  x: 100, y: 50, width: 800, height: 600, mapped: true, type: "_NET_WM_WINDOW_TYPE_NORMAL",
};

export function accessibilityElement(overrides: Partial<AccessibilityElement> = {}): AccessibilityElement {
  return {
    role: "push button", label: "Save", description: null,
    x: 120, y: 80, width: 100, height: 30,
    visible: true, enabled: true, focused: false, focusable: true, clickable: true, editable: false, selected: false,
    target: { backend: "fake", application: ":1.1", path: "/button" },
    ...overrides,
  };
}

const capabilities: Capabilities = {
  session: "x11", display: ":0", waylandDisplay: null,
  executables: { convert: true }, screenshotBackend: "import", canObserveWindows: true, canInteract: true,
};

export class FakeDesktop implements DesktopBackend {
  readonly name = "fake-x11";
  readonly capabilities = capabilities;
  window = { ...testWindow };
  moves: Array<{ x: number; y: number }> = [];
  clicks = 0;
  async getActiveWindow() { return this.window; }
  async listWindows() { return [this.window]; }
  async findWindows() { return [this.window]; }
  async getWindowInfo() { return this.window; }
  async focusWindow() { return this.window; }
  async screenshot() { return { png: Buffer.from("png"), width: 800, height: 600, source: "window" as const, backend: "fake" }; }
  async getMousePosition() { return { x: 0, y: 0 }; }
  async getScreenInfo() { return { width: 800, height: 600, monitors: [] }; }
  async moveMouse(x: number, y: number) { this.moves.push({ x, y }); return { x, y }; }
  async clickMouse() { this.clicks += 1; }
  async mouseDown() {}
  async mouseUp() {}
  async scroll() {}
  async keyPress() {}
  async keyDown() {}
  async keyUp() {}
  async typeText() {}
  async readClipboard() { return ""; }
  async writeClipboard() {}
  async drag() {}
  async configureWindow() { return this.window; }
  async listSurfaces() { return { surfaces: [], partial: false }; }
}

export class FakeAccessibility implements AccessibilityBackend {
  readonly name = "fake";
  constructor(public elements: AccessibilityElement[] = [accessibilityElement()], public partial = false) {}
  async getAvailability() { return { available: true, backend: this.name, reason: null }; }
  async getElementsForWindow() { return { elements: this.elements, partial: this.partial, failedNodes: this.partial ? 1 : 0 }; }
  async getElementGeometry() {
    const element = this.elements[0];
    return element ? { x: element.x, y: element.y, width: element.width, height: element.height } : null;
  }
  async getElementState(target: { path: string }) {
    const element = this.elements.find((item) => item.target.path === target.path);
    if (!element) throw new Error("Element not found");
    return { ...element, label: element.label ?? "", enabled: element.enabled === true };
  }
  async getActions() { return [{ name: "click", description: "Click", keybinding: "" }]; }
  async performAction() { return true; }
  async focusElement() { return false; }
  async readText() { return "document"; }
  async readWindowText() { return { blocks: [{ role: "text", text: "document" }], partial: false }; }
}
