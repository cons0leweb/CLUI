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

export interface AccessibilityScanResult {
  elements: AccessibilityElement[];
  partial: boolean;
  failedNodes: number;
}

export interface AccessibilityBackend {
  readonly name: string;
  getAvailability(): Promise<AccessibilityAvailability>;
  getElementsForWindow(window: WindowInfo, options?: AccessibilityScanOptions): Promise<AccessibilityScanResult>;
  getElementGeometry(target: AccessibilityTarget): Promise<Geometry | null>;
  readText(target: AccessibilityTarget, start: number, end: number): Promise<string>;
  readWindowText(window: WindowInfo, maxCharacters: number): Promise<{ blocks: Array<{ role: string; text: string }>; partial: boolean }>;
  getElementState(target: AccessibilityTarget): Promise<{ role: string; label: string; enabled: boolean; visible: boolean; x: number; y: number; width: number; height: number }>;
  getActions(target: AccessibilityTarget): Promise<Array<{ name: string; description: string; keybinding: string }>>;
  performAction(target: AccessibilityTarget, name: string): Promise<boolean>;
  focusElement(target: AccessibilityTarget): Promise<boolean>;
}
