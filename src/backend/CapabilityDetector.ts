import { CommandError, runCommand, ALLOWED_EXECUTABLES, type AllowedExecutable } from "../system/runCommand.js";
import type { Capabilities } from "../types/desktop.js";

async function probeExecutable(executable: AllowedExecutable, env: NodeJS.ProcessEnv): Promise<{ installed: boolean; operational: boolean }> {
  const probeArgs: Record<AllowedExecutable, string[]> = {
    xdotool: ["getmouselocation"],
    xprop: ["-root", "_NET_ACTIVE_WINDOW"],
    xwininfo: ["-root"],
    xrandr: ["--query"],
    maim: ["--help"],
    import: ["-version"],
    convert: ["-version"],
    scrot: ["--help"],
    xclip: ["-version"],
    wmctrl: ["-m"],
    python3: ["--version"],
  };
  try {
    await runCommand(executable, probeArgs[executable], { timeoutMs: 2_000, maxOutputBytes: 64 * 1024, env });
    return { installed: true, operational: true };
  } catch (error) {
    if (error instanceof CommandError && error.kind === "not_found") return { installed: false, operational: false };
    // A present utility that rejects --help is still installed, but not proven operational.
    return { installed: true, operational: false };
  }
}

export async function detectCapabilities(env: NodeJS.ProcessEnv = process.env): Promise<Capabilities> {
  const entries = await Promise.all(ALLOWED_EXECUTABLES.map(async (name) => [name, await probeExecutable(name, env)] as const));
  const executables = Object.fromEntries(entries.map(([name, status]) => [name, status.operational]));
  const executableInstalled = Object.fromEntries(entries.map(([name, status]) => [name, status.installed]));
  const display = env.DISPLAY || null;
  const waylandDisplay = env.WAYLAND_DISPLAY || null;
  const session = display ? "x11" : waylandDisplay ? "wayland" : "unknown";
  const screenshotBackend = executables.maim ? "maim" : executables.import ? "import" : executables.scrot ? "scrot" : null;
  return {
    session,
    display,
    waylandDisplay,
    executables,
    executableInstalled,
    screenshotBackend,
    canObserveWindows: session === "x11" && Boolean(executables.xprop && executables.xwininfo),
    canInteract: session === "x11" && Boolean(executables.xdotool),
  };
}
