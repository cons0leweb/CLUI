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

export class X11Backend implements DesktopBackend {
  readonly name = "x11";

  constructor(readonly capabilities: Capabilities) {}

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

  async listWindows(): Promise<WindowInfo[]> {
    this.requireWindowObservation();
    const raw = await runText("xprop", ["-root", "_NET_CLIENT_LIST_STACKING"]);
    const ids = parseClientList(raw);
    const settled = await Promise.allSettled(ids.map((id) => this.getWindowInfo(id)));
    return settled
      .filter((result): result is PromiseFulfilledResult<WindowInfo> => result.status === "fulfilled")
      .map((result) => result.value)
      .filter(shouldIncludeWindow);
  }

  async findWindows(query: FindWindowQuery): Promise<WindowInfo[]> {
    const title = query.title.toLocaleLowerCase();
    const className = query.className?.toLocaleLowerCase();
    return (await this.listWindows()).filter((window) => {
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
    let id: string;
    if (target.windowId) {
      id = normalizeWindowId(target.windowId);
    } else if (target.title) {
      const matches = await this.findWindows({ title: target.title });
      if (matches.length === 0) throw new Error(`No visible window title contains '${target.title}'`);
      id = matches[0]!.id;
    } else {
      throw new Error("Either windowId or title is required");
    }
    await runCommand("xdotool", ["windowactivate", "--sync", id], { timeoutMs });
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      const active = await this.getActiveWindow(Math.max(1, Math.ceil(deadline - performance.now())));
      if (active?.id === id) return active;
      await sleep(50);
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
      args.push("-g", `${selectedRegion.width}x${selectedRegion.height}+${selectedRegion.x}+${selectedRegion.y}`);
    }
    return (await runCommand("maim", args, { timeoutMs: 10_000 })).stdout;
  }

  private async screenshotImport(mode: ScreenshotOptions["mode"], windowId?: string, region?: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
    const target = mode === "window" || mode === "active_window" ? requireWindowId(windowId) : "root";
    const args = ["-silent", "-window", target];
    if (mode === "region") {
      const selectedRegion = requireRegion(region);
      args.push("-crop", `${selectedRegion.width}x${selectedRegion.height}+${selectedRegion.x}+${selectedRegion.y}`, "+repage");
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
      await runCommand("xdotool", ["mousemove", "--sync", String(target.x), String(target.y)]);
      return target;
    }
    const start = await this.getMousePosition();
    const steps = Math.min(120, Math.max(2, Math.ceil(durationMs / 16)));
    const delay = durationMs / steps;
    for (let step = 1; step <= steps; step += 1) {
      const px = Math.round(start.x + ((target.x - start.x) * step) / steps);
      const py = Math.round(start.y + ((target.y - start.y) * step) / steps);
      await runCommand("xdotool", ["mousemove", String(px), String(py)]);
      if (step < steps) await sleep(delay);
    }
    return target;
  }

  async clickMouse(button: MouseButton, count = 1, intervalMs = 100): Promise<void> {
    this.requireInteraction();
    await runCommand("xdotool", ["click", "--repeat", String(count), "--delay", String(intervalMs), String(BUTTON_NUMBER[button])]);
  }

  async mouseDown(button: MouseButton): Promise<void> {
    this.requireInteraction();
    await runCommand("xdotool", ["mousedown", String(BUTTON_NUMBER[button])]);
  }

  async mouseUp(button: MouseButton): Promise<void> {
    this.requireInteraction();
    await runCommand("xdotool", ["mouseup", String(BUTTON_NUMBER[button])]);
  }

  async scroll(deltaX: number, deltaY: number): Promise<void> {
    this.requireInteraction();
    const clicks: number[] = [];
    const append = (button: number, count: number) => { for (let index = 0; index < Math.min(100, Math.abs(Math.round(count))); index += 1) clicks.push(button); };
    append(deltaY < 0 ? 4 : 5, deltaY);
    append(deltaX < 0 ? 6 : 7, deltaX);
    for (const button of clicks) await runCommand("xdotool", ["click", String(button)]);
  }

  async keyPress(key: string, modifiers: KeyModifier[] = []): Promise<void> {
    this.requireInteraction();
    await runCommand("xdotool", ["key", "--clearmodifiers", [...modifiers, key].join("+")]);
  }

  async keyDown(key: string): Promise<void> {
    this.requireInteraction();
    await runCommand("xdotool", ["keydown", key]);
  }

  async keyUp(key: string): Promise<void> {
    this.requireInteraction();
    await runCommand("xdotool", ["keyup", key]);
  }

  async typeText(text: string, intervalMs = 12): Promise<void> {
    this.requireInteraction();
    try {
      await runCommand("xdotool", ["type", "--clearmodifiers", "--delay", String(intervalMs), "--", text], { timeoutMs: Math.max(5_000, Math.min(30_000, text.length * (intervalMs + 5))) });
    } catch (error) {
      if (error instanceof CommandError) {
        throw new Error(`xdotool could not type the requested text. Unicode support depends on the active X11 input method and keyboard layout: ${error.message}`);
      }
      throw error;
    }
  }
}
