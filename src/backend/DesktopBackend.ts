import type {
  Capabilities,
  FindWindowQuery,
  Geometry,
  KeyModifier,
  MouseButton,
  Point,
  ScreenInfo,
  Screenshot,
  ScreenshotOptions,
  WindowInfo,
} from "../types/desktop.js";

export interface DesktopBackend {
  readonly name: string;
  readonly capabilities: Capabilities;

  getActiveWindow(): Promise<WindowInfo | null>;
  listWindows(): Promise<WindowInfo[]>;
  findWindows(query: FindWindowQuery): Promise<WindowInfo[]>;
  getWindowInfo(windowId: string): Promise<WindowInfo>;
  focusWindow(target: { windowId?: string; title?: string }, timeoutMs?: number): Promise<WindowInfo>;

  screenshot(options: ScreenshotOptions): Promise<Screenshot>;
  getMousePosition(): Promise<Point>;
  getScreenInfo(): Promise<ScreenInfo>;

  moveMouse(x: number, y: number, durationMs?: number): Promise<Point>;
  clickMouse(button: MouseButton, count?: number, intervalMs?: number): Promise<void>;
  mouseDown(button: MouseButton): Promise<void>;
  mouseUp(button: MouseButton): Promise<void>;
  scroll(deltaX: number, deltaY: number): Promise<void>;

  keyPress(key: string, modifiers?: KeyModifier[]): Promise<void>;
  keyDown(key: string): Promise<void>;
  keyUp(key: string): Promise<void>;
  typeText(text: string, intervalMs?: number): Promise<void>;
}

export function windowRelativePoint(window: Geometry, x: number, y: number, normalized: boolean): Point {
  if (normalized) {
    if (x < 0 || x > 1 || y < 0 || y > 1) {
      throw new RangeError("Normalized window coordinates must be between 0 and 1");
    }
    return {
      x: Math.round(window.x + x * Math.max(0, window.width - 1)),
      y: Math.round(window.y + y * Math.max(0, window.height - 1)),
    };
  }
  if (x < 0 || y < 0 || x >= window.width || y >= window.height) {
    throw new RangeError(`Window-relative coordinates (${x}, ${y}) are outside ${window.width}x${window.height}`);
  }
  return { x: Math.round(window.x + x), y: Math.round(window.y + y) };
}
