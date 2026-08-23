import { spawn } from "node:child_process";
import { ALLOWED_EXECUTABLES, type AllowedExecutable } from "../system/runCommand.js";
import type { Capabilities } from "../types/desktop.js";

async function executableExists(executable: AllowedExecutable): Promise<boolean> {
  return await new Promise((resolve) => {
    const child = spawn(executable, ["--help"], { shell: false, stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.kill("SIGTERM");
      resolve(true);
    });
  });
}

export async function detectCapabilities(env: NodeJS.ProcessEnv = process.env): Promise<Capabilities> {
  const entries = await Promise.all(ALLOWED_EXECUTABLES.map(async (name) => [name, await executableExists(name)] as const));
  const executables = Object.fromEntries(entries);
  const display = env.DISPLAY || null;
  const waylandDisplay = env.WAYLAND_DISPLAY || null;
  const session = display ? "x11" : waylandDisplay ? "wayland" : "unknown";
  const screenshotBackend = executables.maim ? "maim" : executables.import ? "import" : executables.scrot ? "scrot" : null;
  return {
    session,
    display,
    waylandDisplay,
    executables,
    screenshotBackend,
    canObserveWindows: session === "x11" && Boolean(executables.xprop && executables.xwininfo),
    canInteract: session === "x11" && Boolean(executables.xdotool),
  };
}
