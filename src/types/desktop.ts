export interface Point {
  x: number;
  y: number;
}

export interface Geometry extends Point {
  width: number;
  height: number;
}

export interface WindowInfo extends Geometry {
  id: string;
  title: string;
  class: string | null;
  instance: string | null;
  pid: number | null;
  mapped: boolean;
  type: string | null;
}

export interface MonitorInfo extends Geometry {
  name: string;
  primary: boolean;
}

export interface ScreenInfo {
  width: number;
  height: number;
  monitors: MonitorInfo[];
}

export interface ScreenshotOptions {
  mode: "screen" | "active_window" | "window" | "region";
  windowId?: string;
  region?: Geometry;
  maxWidth?: number;
  maxHeight?: number;
}

export interface Screenshot {
  png: Buffer;
  width?: number;
  height?: number;
  source: ScreenshotOptions["mode"];
  backend: string;
}

export interface FindWindowQuery {
  title: string;
  className?: string;
  pid?: number;
}

export type MouseButton = "left" | "middle" | "right";
export type KeyModifier = "Ctrl" | "Alt" | "Shift" | "Super";

export interface Capabilities {
  session: "x11" | "wayland" | "unknown";
  display: string | null;
  waylandDisplay: string | null;
  executables: Record<string, boolean>;
  screenshotBackend: "maim" | "import" | "scrot" | null;
  canObserveWindows: boolean;
  canInteract: boolean;
}
