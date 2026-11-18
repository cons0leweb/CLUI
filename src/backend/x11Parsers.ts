import type { MonitorInfo, WindowInfo } from "../types/desktop.js";

export interface XPropWindowFields {
  title: string;
  className: string | null;
  instance: string | null;
  pid: number | null;
  type: string | null;
}

export function normalizeWindowId(value: string): string {
  const trimmed = value.trim();
  if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(trimmed)) throw new Error(`Invalid X11 window id: ${value}`);
  const numeric = BigInt(trimmed);
  if (numeric <= 0n) throw new Error(`Invalid X11 window id: ${value}`);
  return `0x${numeric.toString(16)}`;
}

function unquoteXProp(value: string): string {
  const equals = value.indexOf("=");
  if (equals < 0) return "";
  const raw = value.slice(equals + 1).trim();
  if (raw === "not found." || raw === "") return "";
  const quoted = raw.match(/^"((?:[^"\\]|\\.)*)"$/);
  return quoted ? quoted[1]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : raw;
}

export function parseXPropWindow(text: string): XPropWindowFields {
  const lines = text.split(/\r?\n/);
  const line = (name: string) => lines.find((item) => item.startsWith(`${name}(`) || item.startsWith(`${name} =`)) ?? "";
  const title = unquoteXProp(line("_NET_WM_NAME")) || unquoteXProp(line("WM_NAME"));
  const classRaw = unquoteXProp(line("WM_CLASS"));
  const classes = [...classRaw.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map((match) => match[1] ?? "");
  const pidMatch = line("_NET_WM_PID").match(/=\s*(\d+)/);
  const typeMatch = line("_NET_WM_WINDOW_TYPE").match(/_NET_WM_WINDOW_TYPE_([A-Z_]+)/);
  return {
    title,
    instance: classes[0] || null,
    className: classes[1] || classes[0] || null,
    pid: pidMatch ? Number(pidMatch[1]) : null,
    type: typeMatch ? typeMatch[1]!.toLowerCase() : null,
  };
}

export function parseClientList(text: string): string[] {
  return [...text.matchAll(/0x[0-9a-f]+/gi)].map((match) => normalizeWindowId(match[0]));
}

export function parseActiveWindowId(text: string): string | null {
  const match = text.match(/#\s+(0x[0-9a-f]+|\d+)/i);
  if (!match || /^0x0$/i.test(match[1]!)) return null;
  return normalizeWindowId(match[1]!);
}

export function parseXWinInfo(text: string): Pick<WindowInfo, "x" | "y" | "width" | "height" | "mapped"> {
  const number = (label: string): number => {
    const match = text.match(new RegExp(`${label}:\\s*(-?\\d+)`, "i"));
    if (!match) throw new Error(`xwininfo output is missing '${label}'`);
    return Number(match[1]);
  };
  return {
    x: number("Absolute upper-left X"),
    y: number("Absolute upper-left Y"),
    width: number("Width"),
    height: number("Height"),
    mapped: /Map State:\s+IsViewable/i.test(text),
  };
}

export function shouldIncludeWindow(window: WindowInfo): boolean {
  if (!window.mapped || !window.title.trim() || window.width <= 1 || window.height <= 1) return false;
  return !["dnd", "desktop", "dock", "toolbar", "menu", "dropdown_menu", "popup_menu", "tooltip", "notification"].includes(window.type ?? "");
}

export function parseXrandrMonitors(text: string): MonitorInfo[] {
  const monitors: MonitorInfo[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([^\s]+)\s+connected\s+(primary\s+)?(\d+)x(\d+)\+(-?\d+)\+(-?\d+)/);
    if (!match) continue;
    monitors.push({
      name: match[1]!,
      primary: Boolean(match[2]),
      width: Number(match[3]),
      height: Number(match[4]),
      x: Number(match[5]),
      y: Number(match[6]),
    });
  }
  return monitors;
}

export function parseWindowTreeIds(output: string): string[] {
  return [...new Set([...output.matchAll(/^\s+(0x[0-9a-f]+)\s/gim)].map((match) => normalizeWindowId(match[1]!)))];
}
