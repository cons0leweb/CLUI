import { createSocket } from "node:dgram";
import type { Mood } from "./World.js";
const kinds = new Set<Mood>(["observe", "type", "click", "activity", "approval", "error", "idle"]);
export interface PetEvent { version: 1; kind: Mood; phase: "start" | "end"; at: number; source: number; seq: number }
export function parsePetEvent(packet: Buffer, now = Date.now()): PetEvent | undefined {
  if (packet.length > 1024) return;
  try {
    const value = JSON.parse(packet.toString()) as PetEvent;
    if (value.version !== 1 || !kinds.has(value.kind) || !["start", "end"].includes(value.phase)) return;
    if (!Number.isSafeInteger(value.at) || Math.abs(now - value.at) > 60_000 || !Number.isSafeInteger(value.source) || value.source <= 0 || !Number.isSafeInteger(value.seq) || value.seq <= 0) return;
    return { version: 1, kind: value.kind, phase: value.phase, at: value.at, source: value.source, seq: value.seq };
  } catch { return; }
}
export class VisualEventReceiver {
  private readonly socket = createSocket("udp4");
  private readonly sequences = new Map<number, number>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private pending: PetEvent[] = [];
  received = 0; dropped = 0;
  constructor(private readonly onEvent: (event: PetEvent) => void) {}
  async listen(port: number): Promise<void> {
    this.socket.on("message", (packet, sender) => {
      if (sender.address !== "127.0.0.1") return;
      const event = parsePetEvent(packet);
      if (!event || event.seq <= (this.sequences.get(event.source) ?? 0)) { this.dropped++; return; }
      if (this.sequences.size >= 32 && !this.sequences.has(event.source)) this.sequences.delete(this.sequences.keys().next().value!);
      this.sequences.set(event.source, event.seq);
      if (this.pending.length >= 32) { this.pending.shift(); this.dropped++; }
      this.pending.push(event);
    });
    await new Promise<void>((resolve, reject) => { this.socket.once("error", reject); this.socket.bind(port, "127.0.0.1", () => { this.socket.off("error", reject); resolve(); }); });
    this.socket.on("error", () => { this.dropped++; });
    this.timer = setInterval(() => { const events = this.pending; this.pending = []; for (const event of events) { this.onEvent(event); this.received++; } }, 50);
  }
  close(): void { clearInterval(this.timer); try { this.socket.close(); } catch { /* Never bound. */ } }
}
