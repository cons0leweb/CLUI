#!/usr/bin/env node
import { CursorIndicator } from "./indicator/CursorIndicator.js";
import { X11IndicatorDisplay } from "./indicator/X11IndicatorDisplay.js";
import { serveUntilClosed } from "./system/serveConnection.js";
import { AtSpiBackend } from "./accessibility/AtSpiBackend.js";
import { detectCapabilities } from "./backend/CapabilityDetector.js";
import { X11Backend } from "./backend/X11Backend.js";
import { log } from "./logging.js";
import { ScreenMapService } from "./screenmap/ScreenMapService.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const capabilities = await detectCapabilities();
  const indicator = capabilities.session === "x11" && process.env.CLUI_CURSOR_INDICATOR !== "0"
    ? new CursorIndicator(new X11IndicatorDisplay()) : undefined;
  const backend = new X11Backend(capabilities, () => indicator?.pulse());
  const accessibility = new AtSpiBackend();
  const screenMap = new ScreenMapService(backend, accessibility);
  const screenMapCapabilities = await screenMap.getCapabilities();
  log("info", "mcp_startup", { name: "clui", version: "0.2.0", transport: "stdio" });
  log("info", "backend_selected", { backend: backend.name, session: capabilities.session });
  log("info", "capabilities_detected", capabilities);
  log("info", "screen_map_capabilities", screenMapCapabilities);
  if (capabilities.session !== "x11") {
    log("error", "x11_unavailable", { message: capabilities.session === "wayland"
      ? "Wayland-only session detected; Wayland backend is not implemented."
      : "DISPLAY is not set; X11 desktop operations are unavailable." });
  }
  let cleanedUp = false;
  const cleanup = async (): Promise<void> => {
    if (cleanedUp) return;
    cleanedUp = true;
    await indicator?.close();
    await backend.close?.();
    await accessibility.close();
  };
  const onSignal = (): void => { void cleanup().finally(() => process.exit(0)); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    await serveUntilClosed(() => createServer(backend, screenMap, indicator));
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await cleanup();
  }
}

main().catch((error) => {
  log("error", "fatal", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
