#!/usr/bin/env node
import { spawn } from "node:child_process";
import { open, access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { control, runPet, runtimeDirectory, type PetOptions } from "./runtime.js";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "start";
  if (!["start", "run", "stop", "status"].includes(command)) throw new Error("Usage: clui-pet start|run|stop|status [--scale 1..4] [--port 47671] [--duration seconds]");
  const args = process.argv.slice(3);
  const value = (name: string, fallback: number) => { const at = args.indexOf(name); return at < 0 ? fallback : Number(args[at + 1]); };
  const options: PetOptions = { scale: value("--scale", 2), port: value("--port", Number(process.env.CLUI_VISUAL_EVENT_PORT ?? 47671)), duration: value("--duration", 0) };
  if (args.includes("--seed")) options.seed = value("--seed", 0);
  if (options.seed !== undefined && !Number.isSafeInteger(options.seed)) throw new Error("Seed must be an integer");
  if (!Number.isInteger(options.scale) || options.scale < 1 || options.scale > 4 || !Number.isInteger(options.port) || options.port < 1024 || options.port > 65535 || !Number.isFinite(options.duration) || options.duration < 0) throw new Error("Invalid pet options");
  if (command === "run") { await runPet(options); return; }
  const directory = await runtimeDirectory();
  if (command === "status" || command === "stop") {
    try {
      const result = await control(directory, command);
      if (command === "stop") {
        for (let i = 0; i < 40; i++) { try { await access(join(directory, "control.sock")); } catch { console.log("CLUI Pet stopped"); return; } await new Promise(resolve => setTimeout(resolve, 50)); }
        throw new Error("Pet shutdown timed out");
      }
      console.log(JSON.stringify(result, null, 2));
    } catch (error) { if (["ENOENT", "ECONNREFUSED"].includes((error as NodeJS.ErrnoException).code ?? "")) console.log("CLUI Pet is not running"); else throw error; }
    return;
  }
  try { const running = await control(directory, "status"); console.log(`CLUI Pet already running (PID ${running.pid})`); return; }
  catch (error) { if (!["ENOENT", "ECONNREFUSED"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
  const log = await open(join(directory, "pet.log"), "a", 0o600);
  // Only this fixed addon entry point is spawned; it has no desktop input or MCP tools.
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "run", ...args], { detached: true, stdio: ["ignore", log.fd, log.fd] });
  child.on("error", () => {}); child.unref(); await log.close();
  for (let i = 0; i < 60; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    try { const status = await control(directory, "status"); if (!status.ready) continue; console.log(`CLUI Pet started (PID ${status.pid}). Log: ${join(directory, "pet.log")}`); return; } catch { /* Wait only in the independent launcher, never in CLUI. */ }
  }
  throw new Error(`Pet did not start; see ${join(directory, "pet.log")}`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
