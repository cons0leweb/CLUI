import type { IndicatorDisplay } from "./X11IndicatorDisplay.js";

export class CursorIndicator {
  private actions = 0;
  private readonly labels = new Map<symbol, string>();
  private lastLabel = "Ожидание следующего действия";
  private sessionUntil = 0;
  private tailUntil = 0;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(private readonly display: IndicatorDisplay, private readonly tailMs = 3_000) {}

  status() {
    return { enabled: !this.closed, available: this.display.available, session_active: this.sessionUntil > Date.now(), active_actions: this.actions };
  }

  beginSession(timeoutMs: number): void {
    if (this.closed) return;
    this.sessionUntil = Date.now() + timeoutMs;
    if (this.actions === 0) this.lastLabel = "Ожидание следующего действия";
    this.refresh();
  }

  endSession(): void {
    this.sessionUntil = this.tailUntil = 0;
    this.refresh();
  }

  beginAction(label = "Управление рабочим столом"): () => void {
    if (this.closed) return () => {};
    const token = Symbol();
    this.labels.set(token, label);
    this.lastLabel = label;
    this.actions += 1;
    this.refresh();
    let finished = false;
    return () => {
      if (finished || this.closed) return;
      finished = true;
      this.labels.delete(token);
      this.actions -= 1;
      this.tailUntil = Date.now() + this.tailMs;
      this.refresh();
    };
  }

  pulse(): void {
    if (!this.closed) this.display.send("pulse");
  }

  private refresh(): void {
    clearTimeout(this.expiry);
    if (this.closed) return;
    const now = Date.now();
    const until = Math.max(this.sessionUntil, this.tailUntil);
    const active = this.actions > 0 || until > now;
    if (active) this.display.send("show", [...this.labels.values()].at(-1) ?? this.lastLabel);
    else this.display.send("hide");
    if (active && !this.heartbeat) {
      this.heartbeat = setInterval(() => this.refresh(), 1_000);
      this.heartbeat.unref();
    } else if (!active && this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
    if (this.actions === 0 && until > now) {
      this.expiry = setTimeout(() => this.refresh(), until - now);
      this.expiry.unref();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.expiry);
    await this.display.close();
  }
}
