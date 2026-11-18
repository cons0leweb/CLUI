import type { DesktopBackend } from "../backend/DesktopBackend.js";
import type { ScreenMapService } from "../screenmap/ScreenMapService.js";

const ACTIONS: Record<string, string> = {
  desktop_perform_element_action: "Действие элемента", desktop_get_element_actions: "Просмотр действий элемента",
  desktop_click: "Клик", desktop_click_window: "Клик", desktop_click_element: "Клик",
  desktop_move_mouse: "Перемещение курсора", desktop_move_mouse_window: "Перемещение курсора",
  desktop_mouse_down: "Зажатие кнопки мыши", desktop_mouse_up: "Отпускание кнопки мыши",
  desktop_scroll: "Прокрутка", desktop_scroll_element: "Прокрутка",
  desktop_drag: "Перетаскивание", desktop_drag_element: "Перетаскивание",
  desktop_focus_window: "Фокус окна", desktop_focus_element: "Фокус элемента",
  desktop_type_text: "Ввод текста", desktop_key_press: "Нажатие клавиши",
  desktop_key_down: "Зажатие клавиши", desktop_key_up: "Отпускание клавиши",
  desktop_configure_window: "Изменение окна", desktop_wait: "Ожидание",
  desktop_write_clipboard: "Запись в буфер обмена", desktop_read_clipboard: "Чтение буфера обмена",
  desktop_act: "Последовательность действий", desktop_screenshot: "Снимок экрана",
  desktop_observe: "Осмотр", desktop_observe_marked: "Осмотр элементов",
  desktop_read_element_text: "Чтение текста", desktop_read_window_text: "Чтение текста",
};

export function cleanIndicatorLabel(value: string): string {
  return Array.from(value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim()).slice(0, 120).join("");
}

export async function describeIndicatorAction(name: string, input: unknown, desktop: DesktopBackend, screenMap: ScreenMapService): Promise<string> {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  let action = ACTIONS[name] ?? "Проверка рабочего стола";
  if (/^desktop_click(?:_window|_element)?$/.test(name)) {
    if (value.button === "right") action = "Правый клик";
    else if (value.button === "middle") action = "Средний клик";
    else if (value.count === 2) action = "Двойной клик";
  }
  if (name === "desktop_scroll" || name === "desktop_scroll_element") {
    const directions = [];
    if (typeof value.delta_y === "number" && value.delta_y !== 0) directions.push(value.delta_y > 0 ? "вниз" : "вверх");
    if (typeof value.delta_x === "number" && value.delta_x !== 0) directions.push(value.delta_x > 0 ? "вправо" : "влево");
    if (directions.length) action += ` ${directions.join(" и ")}`;
  }
  if (name.startsWith("desktop_key_") && typeof value.key === "string") {
    const modifiers = Array.isArray(value.modifiers) ? value.modifiers.filter((item) => typeof item === "string") : [];
    action += ` ${[...modifiers, value.key].join("+")}`;
  }
  if (name === "desktop_configure_window") {
    const states: Record<string, string> = { maximize: "Разворачивание", minimize: "Сворачивание", restore: "Восстановление" };
    action = typeof value.state === "string" ? (states[value.state] ?? action) : action;
  }
  if (name === "desktop_perform_element_action" && typeof value.action_name === "string") action += ` «${value.action_name}»`;
  if (name.includes("clipboard")) return action;
  let target = "";
  try {
    if (typeof value.snapshot_id === "string") {
      const snapshot = screenMap.getSnapshot(value.snapshot_id);
      const elementName = (id: unknown) => {
        if (typeof id !== "number") return "";
        const element = screenMap.getElement(value.snapshot_id as string, id);
        // Only accessible names are used; editable values and document text stay private.
        return /password/i.test(element.role) ? "Защищённое поле" : element.label || element.role;
      };
      target = typeof value.from_element_id === "number"
        ? `${elementName(value.from_element_id)} → ${elementName(value.to_element_id)}`
        : elementName(value.element_id);
      target = `${target ? `${target} · ` : ""}${snapshot.window.title}`;
    } else if (typeof value.window_id === "string") {
      target = (await desktop.getWindowInfo(value.window_id)).title;
      if (/desktop_(click|move_mouse)/.test(name) && typeof value.x === "number" && typeof value.y === "number") {
        target += value.normalized === true
          ? ` (${Math.round(value.x * 100)}%, ${Math.round(value.y * 100)}%)`
          : ` (${Math.round(value.x)}, ${Math.round(value.y)})`;
      }
    } else if (name === "desktop_focus_window" && typeof value.title === "string") {
      target = value.title;
    } else if (name === "desktop_screenshot" && value.mode === "screen") {
      target = "Весь экран";
    } else {
      const point = value.to && typeof value.to === "object" ? value.to as Record<string, unknown> : value;
      const mouseAction = /desktop_(click|move_mouse|mouse_|scroll|drag)/.test(name);
      if (mouseAction) {
        const position = typeof point.x === "number" && typeof point.y === "number" ? { x: point.x, y: point.y } : await desktop.getMousePosition();
        const windows = await desktop.listWindows();
        const window = [...windows].reverse().find((w) => position.x >= w.x && position.y >= w.y && position.x < w.x + w.width && position.y < w.y + w.height);
        target = `${window?.title || "Экран"} (${Math.round(position.x)}, ${Math.round(position.y)})`;
      } else {
        target = (await desktop.getActiveWindow())?.title ?? "";
      }
    }
  } catch {
    // Indicator metadata is best-effort and must not prevent the requested action.
    target = typeof value.window_id === "string" ? `Окно ${value.window_id}` : "Рабочий стол";
  }
  return cleanIndicatorLabel(`${action}${target ? ` → ${target}` : ""}`);
}
