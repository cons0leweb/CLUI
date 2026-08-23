import type { Geometry, Screenshot, WindowInfo } from "./desktop.js";

export type ScreenElementSource = "atspi" | "vision";

export interface ScreenElement extends Geometry {
  id: number;
  role: string;
  label: string | null;
  description: string | null;
  visible: boolean;
  enabled: boolean | null;
  focused: boolean;
  focusable: boolean;
  clickable: boolean;
  editable: boolean;
  selected: boolean;
  source: ScreenElementSource;
}

export interface AccessibilityTarget {
  backend: string;
  application: string;
  path: string;
}

export interface AccessibilityElement extends Omit<ScreenElement, "id" | "source"> {
  target: AccessibilityTarget;
}

export interface ScreenMapSnapshot {
  snapshotId: string;
  createdAt: number;
  expiresAt: number;
  window: WindowInfo;
  screenshot: Screenshot;
  elements: readonly ScreenElement[];
  targets: ReadonlyMap<number, AccessibilityTarget>;
  screenMapAvailable: boolean;
  annotatedScreenshotAvailable: boolean;
  reason: string | null;
}

export interface ScreenMapCapabilities {
  canScreenMap: boolean;
  accessibilityBackend: string | null;
  atSpiAvailable: boolean;
  annotatedScreenshotAvailable: boolean;
  reason: string | null;
}
