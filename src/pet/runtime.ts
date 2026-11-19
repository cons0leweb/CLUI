import { createServer, createConnection } from "node:net";
import { lstat, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { CatWorld, seededRandom } from "./World.js";
import { CatAnimator } from "./CatAnimator.js";
import { X11Desktop } from "./X11Desktop.js";
import { VisualEventReceiver } from "./VisualEventReceiver.js";

export interface PetOptions { scale: number; port: number; duration: number; seed?: number }
export async function runtimeDirectory(): Promise<string> {
  const base = process.env.XDG_RUNTIME_DIR || `/tmp/clui-pet-${process.getuid?.() ?? "user"}`;
  const hash = createHash("sha256").update(process.env.DISPLAY ?? "none").digest("hex").slice(0, 12);
  const path = join(base, `clui-pet-${hash}`);
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o077)) throw new Error("Pet runtime directory must be owned by you with mode 0700");
  return path;
}
export function control(path: string, command: "status" | "stop"): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(join(path, "control.sock"));
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("Pet is not responding")); }, 800);
    let buffer = "";
    socket.on("connect", () => socket.write(command + "\n"));
    socket.on("data", chunk => { buffer += chunk.toString(); if (buffer.length > 8192) socket.destroy(); });
    socket.on("error", error => { clearTimeout(timer); reject(error); });
    socket.on("end", () => { clearTimeout(timer); try { resolve(JSON.parse(buffer) as Record<string, unknown>); } catch { reject(new Error("Invalid pet status")); } });
  });
}
export async function runPet(options: PetOptions): Promise<void> {
  if (!process.env.DISPLAY) throw new Error("CLUI Pet requires Linux/X11 and DISPLAY");
  const path = await runtimeDirectory();
  try { await control(path, "status"); throw new Error("CLUI Pet is already running"); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ECONNREFUSED") await unlink(join(path, "control.sock")).catch(() => {});
    else if (code !== "ENOENT") throw error;
  }
  const desktop = await X11Desktop.connect(options.scale);
  const world = new CatWorld(options.seed === undefined ? Math.random : seededRandom(options.seed)), animator = new CatAnimator();
  const receiver = new VisualEventReceiver(event => world.react(event.kind, event.phase));
  let ownsControl = false;
  let stopped = false, busy = false, frames = 0, errors = 0, timer: ReturnType<typeof setTimeout> | undefined;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let refreshSoon: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let finish!: () => void;
  const done = new Promise<void>(resolve => { finish = resolve; });
  const controlServer = createServer(socket => {
    socket.setTimeout(1000, () => socket.destroy());
    let input = "";
    socket.on("error", () => {});
    socket.on("data", chunk => {
      input += chunk.toString();
      if (input.length > 32) { socket.destroy(); return; }
      if (!input.includes("\n")) return;
      const command = input.trim();
      if (command === "stop") { socket.end(JSON.stringify({ stopping: true })); setImmediate(stop); }
      else if (command === "status") socket.end(JSON.stringify({ pid: process.pid, ready: world.initialized, window: desktop.window, state: world.state, effect: world.effect, x: world.x, y: world.y, support: world.support, frames, jumps: world.jumps, landings: world.landings, falls: world.falls, rides: world.rides, history: [...world.history], events: receiver.received, dropped_events: receiver.dropped, read_errors: errors, memory_bytes: process.memoryUsage().rss }));
      else socket.end(JSON.stringify({ error: "Unknown pet command" }));
    });
  });
  controlServer.on("error", () => {});
  function stop(): void {
    if (stopped) return;
    stopped = true; clearTimeout(timer); clearTimeout(refreshSoon); clearTimeout(deadline); clearInterval(refreshTimer);
    receiver.close(); try { controlServer.close(); } catch { /* Never listened. */ } desktop.close();
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
    if (ownsControl) void unlink(join(path, "control.sock")).catch(() => {}).finally(finish);
    else finish();
  }
  async function refresh(): Promise<void> {
    if (busy || stopped) return;
    busy = true;
    try { const surfaces = await desktop.snapshot(); if (!stopped) world.updateSurfaces(surfaces); }
    catch { errors++; }
    finally { busy = false; }
  }
  try {
    await receiver.listen(options.port);
    await new Promise<void>((resolve, reject) => { controlServer.once("error", reject); controlServer.listen(join(path, "control.sock"), () => { controlServer.off("error", reject); ownsControl = true; resolve(); }); });
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
    await refresh();
    desktop.client.on("event", (event: { name?: string; type?: number; wid?: number; wid1?: number }) => {
      if (event.type === 12 && event.wid === desktop.window) desktop.invalidate();
      if (event.wid === desktop.window || event.wid1 === desktop.window) return;
      if ([17, 18, 19, 22, 28].includes(event.type ?? 0) && !refreshSoon && !stopped) refreshSoon = setTimeout(() => { refreshSoon = undefined; void refresh(); }, 100);
    });
    desktop.client.on("end", stop);
    refreshTimer = setInterval(() => { void refresh(); }, 500);
    let previous = performance.now();
    const frame = () => {
      if (stopped) return;
      const now = performance.now(), dt = Math.min(.1, (now - previous) / 1000); previous = now;
      world.step(dt);
      try { desktop.draw(animator.render(world, dt, desktop.pointer), world.x, world.y); frames++; }
      catch { stop(); return; }
      timer = setTimeout(frame, world.state === "sleep" ? 100 : 33);
    };
    frame();
    if (options.duration > 0) deadline = setTimeout(stop, options.duration * 1000);
    await done;
  } finally { stop(); }
}
