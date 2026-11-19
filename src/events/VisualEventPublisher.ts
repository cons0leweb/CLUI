import { createSocket, type Socket } from "node:dgram";

export type VisualKind = "observe" | "type" | "click" | "activity" | "approval" | "error" | "idle";
export interface VisualEvent { version: 1; kind: VisualKind; phase: "start" | "end"; at: number; source: number; seq: number }

// Lossy, one-way telemetry. No subscriber, reply handler, retry, or acknowledgement.
export class VisualEventPublisher {
  private socket: Socket | undefined;
  private pending = 0;
  private sequence = 0;
  private disabled = false;
  constructor(private readonly enabled: boolean, private readonly port = 47671) {}
  emit(kind: VisualKind, phase: VisualEvent["phase"] = "start"): void {
    if (!this.enabled || this.disabled || this.pending >= 8) return;
    try {
      if (!this.socket) {
        this.socket = createSocket("udp4");
        this.socket.on("error", () => this.close());
        this.socket.unref();
      }
      const packet = Buffer.from(JSON.stringify({ version: 1, kind, phase, at: Date.now(), source: process.pid, seq: ++this.sequence } satisfies VisualEvent));
      this.pending += 1;
      this.socket.send(packet, this.port, "127.0.0.1", () => { this.pending -= 1; });
    } catch { this.close(); }
  }
  close(): void {
    this.disabled = true;
    try { this.socket?.close(); } catch { /* Already closed or never bound. */ }
    this.socket = undefined;
  }
}
const configuredPort = Number(process.env.CLUI_VISUAL_EVENT_PORT ?? 47671);
const publisher = new VisualEventPublisher(process.env.CLUI_VISUAL_EVENTS === "1", Number.isInteger(configuredPort) && configuredPort > 1023 && configuredPort <= 65535 ? configuredPort : 47671);

export function publishVisual(kind: VisualKind, phase: VisualEvent["phase"] = "start"): void {
  // Even malformed environment settings or socket failures cannot escape into execution.
  try { publisher.emit(kind, phase); } catch { /* Visual telemetry is expendable. */ }
}
export function publishLogEvent(event: string, fields: object): void {
  const tool = (fields as { tool?: unknown }).tool;
  if (event === "tool_failure") { publishVisual("error"); return; }
  if (typeof tool !== "string") return;
  const kind: VisualKind = /observe|screenshot|get_|list_|find_|read_/.test(tool) ? "observe"
    : /type_text|key_/.test(tool) ? "type" : /click|mouse_down|perform_element/.test(tool) ? "click" : "activity";
  if (event === "tool_call") publishVisual(kind);
  if (event === "tool_complete") publishVisual(kind, "end");
}
export function publishOutcome(status: string): void {
  if (status !== "dispatched") publishVisual("error");
}
