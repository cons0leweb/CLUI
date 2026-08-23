import type { Geometry, WindowInfo } from "../types/desktop.js";
import type { AccessibilityElement, AccessibilityTarget } from "../types/screenMap.js";

export interface AccessibilityAvailability {
  available: boolean;
  backend: string;
  reason: string | null;
}

export interface AccessibilityScanOptions {
  maxNodes?: number;
  timeoutMs?: number;
}

export interface AccessibilityBackend {
  readonly name: string;
  getAvailability(): Promise<AccessibilityAvailability>;
  getElementsForWindow(window: WindowInfo, options?: AccessibilityScanOptions): Promise<AccessibilityElement[]>;
  getElementGeometry(target: AccessibilityTarget): Promise<Geometry | null>;
  focusElement(target: AccessibilityTarget): Promise<boolean>;
}
