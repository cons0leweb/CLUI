import { describe, expect, it, vi, beforeEach } from "vitest";
import { X11Backend } from "../src/backend/X11Backend.js";
import { parseWindowTreeIds } from "../src/backend/x11Parsers.js";
import { ScreenMapService } from "../src/screenmap/ScreenMapService.js";
import { AnnotationRenderer } from "../src/screenmap/AnnotationRenderer.js";
import { FakeDesktop, FakeAccessibility, accessibilityElement, testWindow } from "./screenMapFixtures.js";
import { ActionGuard } from "../src/safety/ActionGuard.js";
import { summarizeToolInput } from "../src/logging.js";

vi.mock("../src/system/runCommand.js", async (original) => ({
  ...await original<typeof import("../src/system/runCommand.js")>(),
  runCommand: vi.fn(async () => ({ stdout: Buffer.from("Привет\n"), stderr: "", exitCode: 0, durationMs: 1 })),
  runText: vi.fn(async () => ""),
}));
import { runCommand, runText } from "../src/system/runCommand.js";

function backend() {
  return new X11Backend({ session: "x11", display: ":0", waylandDisplay: null,
    executables: { xdotool: true, xclip: true, wmctrl: true, xprop: true, xwininfo: true },
    screenshotBackend: null, canObserveWindows: true, canInteract: true });
}

beforeEach(() => vi.clearAllMocks());

describe("desktop extensions", () => {
  it("keeps clipboard bytes literal and prevents the selection owner inheriting output pipes", async () => {
    const desktop = backend();
    const text = 'Привет\n$(anything) `literal`';
    await desktop.writeClipboard(text);
    expect(runCommand).toHaveBeenCalledWith("xclip", expect.arrayContaining(["-in", "UTF8_STRING"]), { input: Buffer.from(text), discardOutput: true });
    expect(await desktop.readClipboard()).toBe("Привет\n");
    expect(summarizeToolInput("desktop_write_clipboard", { text })).toEqual({ text: { length: text.length } });
  });

  it("releases the mouse button when a drag movement fails", async () => {
    const desktop = backend();
    vi.spyOn(desktop, "moveMouse").mockResolvedValueOnce({ x: 1, y: 2 }).mockRejectedValueOnce(new Error("movement failed"));

    await expect(desktop.drag({ x: 1, y: 2 }, { x: 50, y: 60 }, "left", 500)).rejects.toThrow("movement failed");
    expect(runCommand).toHaveBeenCalledWith("xdotool", ["mouseup", "1"]);
  });

  it("does not interrupt an already held mouse button", async () => {
    const desktop = backend();
    await desktop.mouseDown("right");
    await expect(desktop.drag({ x: 1, y: 2 }, { x: 3, y: 4 }, "left", 500)).rejects.toThrow("Release held");
  });

  it("preserves unspecified window dimensions", async () => {
    const desktop = backend();
    vi.spyOn(desktop, "getWindowInfo").mockResolvedValue(testWindow);
    await desktop.configureWindow(testWindow.id, { width: 900, x: -100 });
    expect(runCommand).toHaveBeenCalledWith("xdotool", ["windowmove", "--sync", testWindow.id, "-100", "50"]);
    expect(runCommand).toHaveBeenCalledWith("xdotool", ["windowsize", "--sync", testWindow.id, "900", "600"]);
    await desktop.configureWindow(testWindow.id, { state: "maximize" });
    expect(runCommand).toHaveBeenCalledWith("wmctrl", ["-ir", testWindow.id, "-b", "add,maximized_vert,maximized_horz"]);
  });

  it("discovers popup surfaces in the X tree and tolerates disappearing windows", async () => {
    vi.mocked(runText).mockResolvedValueOnce('     0x123 "Menu": () 100x100+0+0\n     0x124 (has no name): ()\n');
    const desktop = backend();
    vi.spyOn(desktop, "getWindowInfo").mockResolvedValueOnce({ ...testWindow, type: "popup_menu" }).mockRejectedValueOnce(new Error("closed"));
    const result = await desktop.listSurfaces();
    expect(result.surfaces).toHaveLength(1);
    expect(result.partial).toBe(true);
    expect(parseWindowTreeIds('  0x123 "Menu"\n  0x123 "Menu"\n  0x124 (no name)')).toEqual(["0x123", "0x124"]);
  });

  it("classifies new queries as read-only and interactions as interaction", () => {
    const guard = new ActionGuard();
    for (const tool of ["desktop_read_clipboard", "desktop_read_element_text", "desktop_read_window_text", "desktop_list_surfaces"]) expect(guard.classify(tool, {})).toBe("read_only");
    for (const tool of ["desktop_drag", "desktop_drag_element", "desktop_scroll_element", "desktop_write_clipboard", "desktop_configure_window"]) expect(guard.classify(tool, {})).toBe("interaction");
  });
});

describe("ScreenMap extensions", () => {
  async function setup(elements = [accessibilityElement({ role: "scroll pane", label: null, clickable: false, focusable: false })]) {
    const desktop = new FakeDesktop();
    const accessibility = new FakeAccessibility(elements);
    const renderer = new AnnotationRenderer();
    vi.spyOn(renderer, "render").mockImplementation(async (image) => image);
    const service = new ScreenMapService(desktop, accessibility, undefined, renderer);
    const snapshot = await service.observe({});
    return { desktop, accessibility, service, snapshot };
  }

  it("keeps unlabeled scroll panes and scrolls inside checked geometry", async () => {
    const { desktop, service, snapshot } = await setup();
    const scroll = vi.spyOn(desktop, "scroll");
    expect(snapshot.elements).toHaveLength(1);
    await service.scrollElement(snapshot.snapshotId, 1, 0, 3);
    expect(desktop.moves).toEqual([{ x: 170, y: 95 }]);
    expect(scroll).toHaveBeenCalledWith(0, 3);
    desktop.window = { ...desktop.window, x: 400 };
    await expect(service.scrollElement(snapshot.snapshotId, 1, 0, 3)).rejects.toThrow("geometry changed");
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("checks both drag endpoints before pressing a button", async () => {
    const { desktop, accessibility, service, snapshot } = await setup([
      accessibilityElement(),
      accessibilityElement({ label: "Destination", x: 400, target: { backend: "fake", application: ":1.1", path: "/destination" } }),
    ]);
    const drag = vi.spyOn(desktop, "drag");
    vi.spyOn(accessibility, "getElementGeometry").mockResolvedValueOnce({ x: 120, y: 80, width: 100, height: 30 })
      .mockResolvedValueOnce({ x: 600, y: 80, width: 100, height: 30 });
    const from = snapshot.elements.find((element) => element.label === "Save")!;
    const to = snapshot.elements.find((element) => element.label === "Destination")!;
    await expect(service.dragElements(snapshot.snapshotId, from.id, to.id, "left", 600)).rejects.toThrow("moved or changed size");
    expect(drag).not.toHaveBeenCalled();
  });

  it("passes text ranges to the live accessibility object", async () => {
    const { accessibility, service, snapshot } = await setup();
    const read = vi.spyOn(accessibility, "readText");
    expect(await service.readElementText(snapshot.snapshotId, 1, 100, 200)).toBe("document");
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ path: "/button" }), 100, 200);
  });

  it("excludes password elements from explicit text reads", async () => {
    const { service, snapshot } = await setup([accessibilityElement({ role: "password text" })]);
    await expect(service.readElementText(snapshot.snapshotId, 1, 0, 100)).rejects.toThrow("Password");
  });
});
