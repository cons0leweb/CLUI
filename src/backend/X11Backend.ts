import { dispatchInput } from "../actions/dispatchScope.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DesktopBackend } from "./DesktopBackend.js";
import { CommandError, runCommand, runText } from "../system/runCommand.js";
import { getPngDimensions } from "../system/png.js";
import type {
  Capabilities,
  FindWindowQuery,
  KeyModifier,
  MonitorInfo,
  MouseButton,
  Point,
  ScreenInfo,
  Screenshot,
  ScreenshotOptions,
  WindowInfo,
} from "../types/desktop.js";
import {
  normalizeWindowId,
  parseWindowTreeIds,
  parseActiveWindowId,
  parseClientList,
  parseXPropWindow,
  parseXrandrMonitors,
  parseXWinInfo,
  shouldIncludeWindow,
} from "./x11Parsers.js";

const BUTTON_NUMBER: Record<MouseButton, number> = { left: 1, middle: 2, right: 3 };

export class BackendUnavailableError extends Error {
  constructor(message: string, readonly capability?: string) {
    super(message);
    this.name = "BackendUnavailableError";
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requireWindowId(windowId: string | undefined): string {
  if (!windowId) throw new Error("A window id is required for this screenshot mode");
  return normalizeWindowId(windowId);
}

function requireRegion(region: { x: number; y: number; width: number; height: number } | undefined): { x: number; y: number; width: number; height: number } {
  if (!region) throw new Error("A region is required for region screenshot mode");
  return region;
}

function signed(value: number): string { return value < 0 ? String(value) : `+${value}`; }
export function x11Geometry(region: { x: number; y: number; width: number; height: number }): string {
  return `${region.width}x${region.height}${signed(region.x)}${signed(region.y)}`;
}

export class X11Backend implements DesktopBackend {
  readonly name = "x11";
  private readonly heldKeys = new Set<string>();
  private readonly heldButtons = new Set<MouseButton>();

  constructor(readonly capabilities: Capabilities, private readonly onPointerPress?: () => void) {}

  private requireX11(): void {
    if (this.capabilities.session === "x11") return;
    const detail = this.capabilities.session === "wayland"
      ? "Wayland-only session detected. CLUI currently requires X11 and does not use unsafe Wayland bypasses."
      : "No X11 DISPLAY was detected. Start CLUI inside an X11 session and forward DISPLAY.";
    throw new BackendUnavailableError(detail, "DISPLAY");
  }

  private requireExecutable(name: string): void {
    this.requireX11();
    if (!this.capabilities.executables[name]) {
      throw new BackendUnavailableError(`Required executable '${name}' is unavailable. Install the corresponding Linux package and restart CLUI.`, name);
    }
  }

  private requireWindowObservation(): void {
    this.requireExecutable("xprop");
    this.requireExecutable("xwininfo");
  }

  private requireInteraction(): void {
    this.requireExecutable("xdotool");
  }

  async getActiveWindow(timeoutMs = 5_000): Promise<WindowInfo | null> {
    this.requireWindowObservation();
    const deadline = performance.now() + timeoutMs;
    const raw = await runText("xprop", ["-root", "_NET_ACTIVE_WINDOW"], Math.max(1, Math.ceil(deadline - performance.now())));
    const id = parseActiveWindowId(raw);
    return id ? await this.getWindowInfo(id, Math.max(1, Math.ceil(deadline - performance.now()))) : null;
  }

  async listWindows(timeoutMs = 5_000): Promise<WindowInfo[]> {
    this.requireWindowObservation();
    const deadline = performance.now() + timeoutMs;
    const raw = await runText("xprop", ["-root", "_NET_CLIENT_LIST_STACKING"], Math.max(1, Math.ceil(deadline - performance.now())));
    const ids = parseClientList(raw);
    const settled = await Promise.allSettled(ids.map((id) => this.getWindowInfo(id, Math.max(1, Math.ceil(deadline - performance.now())))));
    const failures = settled.filter((result) => result.status === "rejected").length;
    if (failures > 0) throw new Error(`Unable to inspect ${failures} of ${ids.length} X11 windows`);
    const successful = settled
      .filter((result): result is PromiseFulfilledResult<WindowInfo> => result.status === "fulfilled")
      .map((result) => result.value)
      .filter(shouldIncludeWindow);
    if (ids.length > 0 && successful.length === 0) throw new Error("X11 listed windows, but none could be inspected");
    return successful;
  }

  async findWindows(query: FindWindowQuery, timeoutMs?: number): Promise<WindowInfo[]> {
    const title = query.title.toLocaleLowerCase();
    const className = query.className?.toLocaleLowerCase();
    return (await this.listWindows(timeoutMs)).filter((window) => {
      if (!window.title.toLocaleLowerCase().includes(title)) return false;
      if (className && !(window.class ?? "").toLocaleLowerCase().includes(className)) return false;
      return query.pid === undefined || window.pid === query.pid;
    });
  }

  async getWindowInfo(windowId: string, timeoutMs = 5_000): Promise<WindowInfo> {
    this.requireWindowObservation();
    const id = normalizeWindowId(windowId);
    const [properties, geometry] = await Promise.all([
      runText("xprop", ["-id", id, "_NET_WM_NAME", "WM_NAME", "WM_CLASS", "_NET_WM_PID", "_NET_WM_WINDOW_TYPE"], timeoutMs),
      runText("xwininfo", ["-id", id], timeoutMs),
    ]);
    const fields = parseXPropWindow(properties);
    return { id, ...fields, class: fields.className, ...parseXWinInfo(geometry) };
  }

  async focusWindow(target: { windowId?: string; title?: string }, timeoutMs = 2_000): Promise<WindowInfo> {
    this.requireInteraction();
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("timeoutMs must be positive");
    const deadline = performance.now() + timeoutMs;
    const remaining = () => Math.ceil(deadline - performance.now());
    const requireRemaining = (): number => {
      const value = remaining();
      if (value <= 0) throw new Error(`Window focus timed out after ${timeoutMs}ms`);
      return value;
    };
    let id: string;
    if (target.windowId) {
      id = normalizeWindowId(target.windowId);
    } else if (target.title) {
      const matches = await this.findWindows({ title: target.title }, requireRemaining());
      if (matches.length === 0) throw new Error(`No visible window title contains '${target.title}'`);
      id = matches[0]!.id;
    } else {
      throw new Error("Either windowId or title is required");
    }
    await dispatchInput(() => runCommand("xdotool", ["windowactivate", "--sync", id], { timeoutMs: requireRemaining() }));
    while (performance.now() < deadline) {
      const active = await this.getActiveWindow(requireRemaining());
      if (active?.id === id) return active;
      await sleep(Math.min(50, Math.max(0, remaining())));
    }
    throw new Error(`Window ${id} did not become active within ${timeoutMs}ms`);
  }

  async screenshot(options: ScreenshotOptions): Promise<Screenshot> {
    this.requireX11();
    const backend = this.capabilities.screenshotBackend;
    if (!backend) throw new BackendUnavailableError("No screenshot utility found. Install maim, ImageMagick, or scrot.", "screenshot");

    let windowId = options.windowId;
    let region = options.region;
    if (options.mode === "active_window") {
      const active = await this.getActiveWindow();
      if (!active) throw new Error("There is no active X11 window");
      windowId = active.id;
    }
    if (options.mode === "window" && !windowId) throw new Error("windowId is required in window mode");
    if (options.mode === "region" && !region) throw new Error("region is required in region mode");
    if (options.mode === "region") region = requireRegion(region);

    let png: Buffer;
    if (backend === "maim") png = await this.screenshotMaim(options.mode, windowId, region);
    else if (backend === "import") png = await this.screenshotImport(options.mode, windowId, region);
    else png = await this.screenshotScrot(options.mode, windowId, region);

    if ((options.maxWidth || options.maxHeight) && !this.capabilities.executables.convert) {
      throw new BackendUnavailableError("Screenshot downscaling requires ImageMagick 'convert'. Install ImageMagick or omit max_width/max_height.", "convert");
    }
    if (options.maxWidth || options.maxHeight) {
      const box = `${options.maxWidth ?? ""}x${options.maxHeight ?? ""}>`;
      png = (await runCommand("convert", ["png:-", "-resize", box, "png:-"], { input: png, timeoutMs: 10_000 })).stdout;
    }
    const dimensions = getPngDimensions(png);
    return {
      png,
      ...(dimensions ?? {}),
      source: options.mode,
      backend,
    };
  }

  private async screenshotMaim(mode: ScreenshotOptions["mode"], windowId?: string, region?: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
    const args = ["-u", "-f", "png"];
    if (mode === "window" || mode === "active_window") args.push("-i", requireWindowId(windowId));
    if (mode === "region") {
      const selectedRegion = requireRegion(region);
      args.push("-g", x11Geometry(selectedRegion));
    }
    return (await runCommand("maim", args, { timeoutMs: 10_000 })).stdout;
  }

  private async screenshotImport(mode: ScreenshotOptions["mode"], windowId?: string, region?: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
    const target = mode === "window" || mode === "active_window" ? requireWindowId(windowId) : "root";
    const args = ["-silent", "-window", target];
    if (mode === "region") {
      const selectedRegion = requireRegion(region);
      args.push("-crop", x11Geometry(selectedRegion), "+repage");
    }
    args.push("png:-");
    return (await runCommand("import", args, { timeoutMs: 10_000 })).stdout;
  }

  private async screenshotScrot(mode: ScreenshotOptions["mode"], windowId?: string, region?: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
    if (mode === "window" || mode === "active_window") {
      const window = await this.getWindowInfo(requireWindowId(windowId));
      region = window;
    }
    const directory = await mkdtemp(join(tmpdir(), "clui-shot-"));
    const path = join(directory, "screenshot.png");
    try {
      const args = [];
      if (region) args.push("-a", `${region.x},${region.y},${region.width},${region.height}`);
      args.push(path);
      await runCommand("scrot", args, { timeoutMs: 10_000 });
      return await readFile(path);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async getMousePosition(): Promise<Point> {
    this.requireInteraction();
    const raw = await runText("xdotool", ["getmouselocation", "--shell"]);
    const x = raw.match(/^X=(-?\d+)$/m);
    const y = raw.match(/^Y=(-?\d+)$/m);
    if (!x || !y) throw new Error("Unable to parse xdotool mouse position");
    return { x: Number(x[1]), y: Number(y[1]) };
  }

  async getScreenInfo(): Promise<ScreenInfo> {
    this.requireExecutable("xwininfo");
    const root = parseXWinInfo(await runText("xwininfo", ["-root"]));
    let monitors: MonitorInfo[] = [];
    if (this.capabilities.executables.xrandr) {
      try { monitors = parseXrandrMonitors(await runText("xrandr", ["--query"])); } catch { /* root geometry remains useful */ }
    }
    return { width: root.width, height: root.height, monitors };
  }

  async moveMouse(x: number, y: number, durationMs = 0): Promise<Point> {
    this.requireInteraction();
    const target = { x: Math.round(x), y: Math.round(y) };
    if (durationMs <= 0) {
      await dispatchInput(() => runCommand("xdotool", ["mousemove", "--sync", String(target.x), String(target.y)]));
      return target;
    }
    const start = await this.getMousePosition();
    const movementStarted = performance.now();
    const steps = Math.min(120, Math.max(2, Math.ceil(durationMs / 16)));
    const deadline = movementStarted + durationMs;
    for (let step = 1; step <= steps; step += 1) {
      const px = Math.round(start.x + ((target.x - start.x) * step) / steps);
      const py = Math.round(start.y + ((target.y - start.y) * step) / steps);
      await dispatchInput(() => runCommand("xdotool", ["mousemove", String(px), String(py)]));
      if (step < steps) await sleep(Math.max(0, movementStarted + (durationMs * step) / steps - performance.now()));
    }
    return target;
  }

  async clickMouse(button: MouseButton, count = 1, intervalMs = 100): Promise<void> {
    this.requireInteraction();
    this.onPointerPress?.();
    await dispatchInput(() => runCommand("xdotool", ["click", "--repeat", String(count), "--delay", String(intervalMs), String(BUTTON_NUMBER[button])], { timeoutMs: Math.max(5_000, count * intervalMs + 2_000) }));
  }

  async mouseDown(button: MouseButton): Promise<void> {
    this.requireInteraction();
    this.onPointerPress?.();
    await dispatchInput(async () => {
      this.heldButtons.add(button);
      await runCommand("xdotool", ["mousedown", String(BUTTON_NUMBER[button])]);
    });
  }

  async mouseUp(button: MouseButton): Promise<void> {
    this.requireInteraction();
    await dispatchInput(() => runCommand("xdotool", ["mouseup", String(BUTTON_NUMBER[button])]));
    this.heldButtons.delete(button);
  }

  async scroll(deltaX: number, deltaY: number): Promise<void> {
    this.requireInteraction();
    if (deltaY) await dispatchInput(() => runCommand("xdotool", ["click", "--repeat", String(Math.min(100, Math.abs(Math.round(deltaY)))), String(deltaY < 0 ? 4 : 5)]));
    if (deltaX) await dispatchInput(() => runCommand("xdotool", ["click", "--repeat", String(Math.min(100, Math.abs(Math.round(deltaX)))), String(deltaX < 0 ? 6 : 7)]));
  }

  async keyPress(key: string, modifiers: KeyModifier[] = []): Promise<void> {
    this.requireInteraction();
    await dispatchInput(() => runCommand("xdotool", ["key", "--clearmodifiers", [...modifiers, key].join("+")]));
  }

  async keyDown(key: string): Promise<void> {
    this.requireInteraction();
    await dispatchInput(async () => {
      this.heldKeys.add(key);
      await runCommand("xdotool", ["keydown", key]);
    });
  }

  async keyUp(key: string): Promise<void> {
    this.requireInteraction();
    await dispatchInput(() => runCommand("xdotool", ["keyup", key]));
    this.heldKeys.delete(key);
  }

  async typeText(text: string, intervalMs = 12): Promise<void> {
    this.requireInteraction();
    try {
      await dispatchInput(() => runCommand("xdotool", ["type", "--clearmodifiers", "--delay", String(intervalMs), "--", text], { timeoutMs: Math.max(5_000, text.length * (intervalMs + 5) + 1_000) }));
    } catch (error) {
      if (error instanceof CommandError) {
        throw new Error(`xdotool could not type the requested text. Unicode support depends on the active X11 input method and keyboard layout: ${error.message}`);
      }
      throw error;
    }
  }

  async readClipboard(): Promise<string> {
    this.requireExecutable("xclip");
    return (await runCommand("xclip", ["-selection", "clipboard", "-out", "-target", "UTF8_STRING"], { maxOutputBytes: 4 * 1024 * 1024 })).stdout.toString("utf8");
  }

  async writeClipboard(text: string): Promise<void> {
    this.requireExecutable("xclip");
    // xclip's selection owner outlives its parent. Don't let it inherit MCP pipes.
    await dispatchInput(() => runCommand("xclip", ["-selection", "clipboard", "-in", "-silent", "-target", "UTF8_STRING"], { input: Buffer.from(text), discardOutput: true }));
  }

  async drag(from: Point, to: Point, button: MouseButton, durationMs: number): Promise<void> {
    if (this.heldButtons.size > 0) throw new Error("Release held mouse buttons before dragging");
    await this.moveMouse(from.x, from.y);
    try {
      await this.mouseDown(button);
      await this.moveMouse(to.x, to.y, durationMs);
    } finally {
      // Release our own held button even if focus/geometry checks stopped the drag.
      // This is cleanup, not a retry or a fallback to another action.
      if (this.heldButtons.has(button)) {
        await runCommand("xdotool", ["mouseup", String(BUTTON_NUMBER[button])]);
        this.heldButtons.delete(button);
      }
    }
  }

  async configureWindow(windowId: string, options: { x?: number; y?: number; width?: number; height?: number; state?: "maximize" | "minimize" | "restore" }): Promise<WindowInfo> {
    this.requireInteraction();
    const id = normalizeWindowId(windowId);
    if (options.state === "maximize" || options.state === "restore") {
      this.requireExecutable("wmctrl");
      if (options.state === "restore") await dispatchInput(() => runCommand("xdotool", ["windowmap", "--sync", id]));
      await dispatchInput(() => runCommand("wmctrl", ["-ir", id, "-b", `${options.state === "maximize" ? "add" : "remove"},maximized_vert,maximized_horz`]));
    } else if (options.state === "minimize") {
      await dispatchInput(() => runCommand("xdotool", ["windowminimize", "--sync", id]));
    }
    if (options.x !== undefined || options.y !== undefined) {
      const current = await this.getWindowInfo(id);
      await dispatchInput(() => runCommand("xdotool", ["windowmove", "--sync", id, String(options.x ?? current.x), String(options.y ?? current.y)]));
    }
    if (options.width !== undefined || options.height !== undefined) {
      const current = await this.getWindowInfo(id);
      await dispatchInput(() => runCommand("xdotool", ["windowsize", "--sync", id, String(options.width ?? current.width), String(options.height ?? current.height)]));
    }
    return this.getWindowInfo(id);
  }

  async listSurfaces(): Promise<{ surfaces: WindowInfo[]; partial: boolean }> {
    this.requireWindowObservation();
    // Override-redirect popups are absent from _NET_CLIENT_LIST_STACKING.
    const ids = parseWindowTreeIds(await runText("xwininfo", ["-root", "-tree"]));
    const surfaces: WindowInfo[] = [];
    const deadline = performance.now() + 8_000;
    let inspected = 0;
    let partial = false;
    while (inspected < ids.length && inspected < 500 && performance.now() < deadline) {
      const batch = ids.slice(inspected, inspected + 20);
      inspected += batch.length;
      const results = await Promise.allSettled(batch.map((id) => this.getWindowInfo(id, Math.max(1, Math.ceil(deadline - performance.now())))));
      for (const result of results) {
        if (result.status === "rejected") { partial = true; continue; }
        const window = result.value;
        if (window.mapped && /^(menu|popup_menu|dropdown_menu|tooltip|dialog|notification)$/.test(window.type ?? "")) surfaces.push(window);
      }
    }
    return { surfaces, partial: partial || inspected < ids.length };
  }

  async close(): Promise<void> {
    for (const key of [...this.heldKeys]) { try { await this.keyUp(key); } catch { /* best effort */ } }
    for (const button of [...this.heldButtons]) { try { await this.mouseUp(button); } catch { /* best effort */ } }
  }
}
