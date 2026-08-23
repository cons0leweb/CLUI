#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { detectCapabilities } from "./backend/CapabilityDetector.js";
import { X11Backend } from "./backend/X11Backend.js";
import { log } from "./logging.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const capabilities = await detectCapabilities();
  const backend = new X11Backend(capabilities);
  log("info", "mcp_startup", { name: "clui", version: "0.1.0", transport: "stdio" });
  log("info", "backend_selected", { backend: backend.name, session: capabilities.session });
  log("info", "capabilities_detected", capabilities as unknown as Record<string, unknown>);
  if (capabilities.session !== "x11") {
    log("error", "x11_unavailable", { message: capabilities.session === "wayland"
      ? "Wayland-only session detected; Wayland backend is not implemented."
      : "DISPLAY is not set; X11 desktop operations are unavailable." });
  }
  await serveStdio(() => createServer(backend));
}

main().catch((error) => {
  log("error", "fatal", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
