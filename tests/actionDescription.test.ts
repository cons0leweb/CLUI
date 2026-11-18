import { describe, expect, it, vi } from "vitest";
import { cleanIndicatorLabel, describeIndicatorAction } from "../src/indicator/actionDescription.js";
import { CursorIndicator } from "../src/indicator/CursorIndicator.js";
import { ScreenMapService } from "../src/screenmap/ScreenMapService.js";
import { FakeDesktop, FakeAccessibility } from "./screenMapFixtures.js";

function fixture() {
  const desktop = new FakeDesktop();
  const screenMap = new ScreenMapService(desktop, new FakeAccessibility());
  return { desktop, screenMap, describe: (name: string, input: unknown) => describeIndicatorAction(name, input, desktop, screenMap) };
}

describe("indicator action descriptions", () => {
  it("shows keyboard action and window without exposing typed text", async () => {
    const { describe } = fixture();
    expect(await describe("desktop_type_text", { text: "secret password" })).toBe("Ввод текста → Test window");
    expect(await describe("desktop_key_press", { key: "v", modifiers: ["Ctrl"] })).toBe("Нажатие клавиши Ctrl+v → Test window");
    expect(await describe("desktop_write_clipboard", { text: "secret" })).toBe("Запись в буфер обмена");
  });

  it("resolves pointer targets by position rather than the active window", async () => {
    const { desktop, describe } = fixture();
    vi.spyOn(desktop, "listWindows").mockResolvedValue([{ ...desktop.window, title: "Other window" }]);
    expect(await describe("desktop_click", { x: 200, y: 200 })).toBe("Клик → Other window (200, 200)");
  });

  it("includes scroll direction and distinguishes right clicks", async () => {
    const { describe } = fixture();
    expect(await describe("desktop_scroll", { delta_y: -3 })).toMatch(/^Прокрутка вверх →/);
    expect(await describe("desktop_click", { button: "right" })).toMatch(/^Правый клик →/);
    expect(await describe("desktop_click_window", { window_id: "0x123", x: .5, y: .2, normalized: true })).toBe("Клик → Test window (50%, 20%)");
  });

  it("resolves ScreenMap names without another accessibility scan", async () => {
    const { screenMap, describe } = fixture();
    vi.spyOn(screenMap, "getSnapshot").mockReturnValue({ window: { title: "Editor" } } as never);
    vi.spyOn(screenMap, "getElement").mockReturnValue({ role: "button", label: "Сохранить" } as never);
    expect(await describe("desktop_click_element", { snapshot_id: "snapshot", element_id: 1 })).toBe("Клик → Сохранить · Editor");
  });

  it("uses a fallback when the target disappears instead of failing the action", async () => {
    const { desktop, describe } = fixture();
    vi.spyOn(desktop, "getWindowInfo").mockRejectedValue(new Error("gone"));
    expect(await describe("desktop_focus_window", { window_id: "0x123" })).toBe("Фокус окна → Окно 0x123");
  });

  it("strips control and bidi characters and limits Unicode labels", () => {
    expect(cleanIndicatorLabel(" a\n\u001b\u202e b ")).toBe("a b");
    expect(Array.from(cleanIndicatorLabel("🌍".repeat(300)))).toHaveLength(120);
  });

  it("restores the remaining action label when nested operations end", async () => {
    const display = { available: true, send: vi.fn(), close: vi.fn(async () => {}) };
    const indicator = new CursorIndicator(display);
    const outer = indicator.beginAction("Последовательность действий");
    const inner = indicator.beginAction("Клик → Сохранить");
    expect(display.send).toHaveBeenLastCalledWith("show", "Клик → Сохранить");
    inner();
    expect(display.send).toHaveBeenLastCalledWith("show", "Последовательность действий");
    outer();
    await indicator.close();
  });
});
