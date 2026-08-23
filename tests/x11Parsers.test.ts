import { describe, expect, it } from "vitest";
import { parseActiveWindowId, parseClientList, parseXPropWindow, parseXWinInfo, shouldIncludeWindow } from "../src/backend/x11Parsers.js";
import type { WindowInfo } from "../src/types/desktop.js";

describe("X11 parsers", () => {
  it("parses absolute geometry including negative monitor coordinates", () => {
    expect(parseXWinInfo(`
      Absolute upper-left X:  -1920
      Absolute upper-left Y:  40
      Width: 1920
      Height: 1080
      Map State: IsViewable
    `)).toEqual({ x: -1920, y: 40, width: 1920, height: 1080, mapped: true });
  });

  it("parses xprop title, class, pid, and type", () => {
    expect(parseXPropWindow(`
_NET_WM_NAME(UTF8_STRING) = "Minecraft 1.21"
WM_NAME(STRING) = "fallback"
WM_CLASS(STRING) = "minecraft", "Minecraft"
_NET_WM_PID(CARDINAL) = 4242
_NET_WM_WINDOW_TYPE(ATOM) = _NET_WM_WINDOW_TYPE_NORMAL
    `)).toEqual({ title: "Minecraft 1.21", instance: "minecraft", className: "Minecraft", pid: 4242, type: "normal" });
  });

  it("parses client and active ids", () => {
    expect(parseClientList("_NET_CLIENT_LIST_STACKING(WINDOW): window id # 0x1a, 0x02B")).toEqual(["0x1a", "0x2b"]);
    expect(parseActiveWindowId("_NET_ACTIVE_WINDOW(WINDOW): window id # 0x02B")).toBe("0x2b");
    expect(parseActiveWindowId("_NET_ACTIVE_WINDOW(WINDOW): window id # 0x0")).toBeNull();
  });
});

describe("window filtering", () => {
  const base: WindowInfo = { id: "0x1", title: "App", class: "App", instance: "app", pid: 1, x: 0, y: 0, width: 800, height: 600, mapped: true, type: "normal" };

  it("keeps visible normal application windows", () => expect(shouldIncludeWindow(base)).toBe(true));
  it("filters docks, unmapped windows, and untitled helpers", () => {
    expect(shouldIncludeWindow({ ...base, type: "dock" })).toBe(false);
    expect(shouldIncludeWindow({ ...base, mapped: false })).toBe(false);
    expect(shouldIncludeWindow({ ...base, title: "" })).toBe(false);
  });
});
