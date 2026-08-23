import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { detectCapabilities } from "../src/backend/CapabilityDetector.js";
import { X11Backend } from "../src/backend/X11Backend.js";

const backend = new X11Backend(await detectCapabilities());
const minecraft = (await backend.listWindows()).filter((window) => /minecraft/i.test(`${window.title} ${window.class ?? ""}`));

if (minecraft.length === 0) {
  const active = await backend.getActiveWindow();
  if (!active) throw new Error("Minecraft is absent and there is no safe active window to observe.");
  const screenshot = await backend.screenshot({ mode: "window", windowId: active.id, maxWidth: 1280, maxHeight: 720 });
  const output = resolve("artifacts/demo-active-window.png");
  await mkdir(resolve("artifacts"), { recursive: true });
  await writeFile(output, screenshot.png);
  console.log(JSON.stringify({ minecraft_found: false, fallback: "observe-only active window", window: active, screenshot: output }, null, 2));
  process.exit(0);
}

const window = minecraft[0]!;
await backend.focusWindow({ windowId: window.id });
const before = await backend.screenshot({ mode: "window", windowId: window.id });
await backend.keyPress("Escape");
await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
const after = await backend.screenshot({ mode: "window", windowId: window.id });
await mkdir(resolve("artifacts"), { recursive: true });
await Promise.all([
  writeFile(resolve("artifacts/minecraft-before.png"), before.png),
  writeFile(resolve("artifacts/minecraft-after-escape.png"), after.png),
]);
console.log(JSON.stringify({ minecraft_found: true, window, screenshots: ["artifacts/minecraft-before.png", "artifacts/minecraft-after-escape.png"], action: "Escape" }, null, 2));
