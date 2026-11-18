import { fileURLToPath } from "node:url";
import { spawnAllowedCommand } from "../system/runCommand.js";
import { log } from "../logging.js";

export type IndicatorCommand = "show" | "pulse" | "hide";
export interface IndicatorDisplay {
  readonly available: boolean | null;
  send(command: IndicatorCommand, label?: string): void;
  close(): Promise<void>;
}

export class X11IndicatorDisplay implements IndicatorDisplay {
  available: boolean | null = null;
  private child: ReturnType<typeof spawnAllowedCommand> | undefined;
  private pending: IndicatorCommand = "hide";
  private label = "Управление рабочим столом";
  private closed = false;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;

  send(command: IndicatorCommand, label?: string): void {
    if (label !== undefined) this.label = label;
    if (this.closed || this.available === false) return;
    this.pending = command;
    if (!this.child && command === "hide") return;
    if (!this.child) this.start();
    if (this.available) this.child?.stdin?.write(`${JSON.stringify({ command, label: this.label })}\n`);
  }

  private start(): void {
    const child = spawnAllowedCommand("python3", ["-u", fileURLToPath(new URL("./cursor_overlay.py", import.meta.url))], { input: Buffer.alloc(0) });
    this.child = child;
    const unavailable = (): void => {
      clearTimeout(this.readyTimer);
      if (!this.closed && this.available !== false) log("error", "cursor_indicator_unavailable", { message: "X11 indicator helper failed; check python3, libX11, libXext, libXft and DISPLAY" });
      this.available = false;
      child.kill("SIGKILL");
    };
    child.on("error", unavailable);
    child.stdin?.on("error", unavailable);
    // Never forward helper stdout to the MCP transport.
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      if (this.available !== null) return;
      output += chunk.toString("utf8");
      if (output.length > 128) { unavailable(); return; }
      if (output.includes("ready\n")) {
        clearTimeout(this.readyTimer);
        this.available = true;
        child.stdin?.write(`${JSON.stringify({ command: this.pending, label: this.label })}\n`);
      }
    });
    child.stderr?.resume();
    child.once("exit", () => { if (!this.closed) unavailable(); });
    this.readyTimer = setTimeout(unavailable, 3_000);
    this.readyTimer.unref();
  }

  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.readyTimer);
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 1_000);
      child.once("close", () => { clearTimeout(timer); resolve(); });
      child.stdin?.end(`${JSON.stringify({ command: "quit" })}\n`);
    });
  }
}
