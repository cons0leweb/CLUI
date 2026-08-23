import { detectCapabilities } from "../src/backend/CapabilityDetector.js";
import { X11Backend } from "../src/backend/X11Backend.js";

const capabilities = await detectCapabilities();
const backend = new X11Backend(capabilities);

console.log(JSON.stringify({ capabilities }, null, 2));
const checks = await Promise.allSettled([
  backend.getActiveWindow(),
  backend.screenshot({ mode: "screen", maxWidth: 1280, maxHeight: 720 }),
  backend.getMousePosition(),
  backend.listWindows(),
]);
const names = ["active_window", "screenshot", "mouse_position", "window_list"] as const;
const output = Object.fromEntries(checks.map((result, index) => {
  if (result.status === "rejected") return [names[index], { ok: false, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }];
  if (names[index] === "screenshot") {
    const screenshot = result.value as Awaited<ReturnType<typeof backend.screenshot>>;
    return [names[index], { ok: true, bytes: screenshot.png.length, width: screenshot.width, height: screenshot.height, backend: screenshot.backend }];
  }
  return [names[index], { ok: true, value: result.value }];
}));
console.log(JSON.stringify(output, null, 2));

if (process.argv.includes("--move-mouse") && checks[2]?.status === "fulfilled") {
  const mouse = checks[2].value;
  await backend.moveMouse(mouse.x, mouse.y);
  console.log("Explicit --move-mouse flag supplied; moved pointer back to its original position.");
}

if (checks.some((result) => result.status === "rejected")) process.exitCode = 1;
