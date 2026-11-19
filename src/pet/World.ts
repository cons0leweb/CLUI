export interface Surface { owner: number; x: number; y: number; width: number; kind: "window" | "panel" | "floor"; anchorX?: number }
export interface DesktopWindow { owner: number; x: number; y: number; width: number; height: number; kind: "window" | "panel" }
export interface Monitor { x: number; y: number; width: number; height: number }
export type Mood = "idle" | "observe" | "type" | "click" | "activity" | "approval" | "error";
export type CatState = "sit" | "walk" | "run" | "crouch" | "jump" | "fall" | "land" | "sleep" | "wake" | "groom" | "stretch" | "observe" | "type" | "approval" | "confused";
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export function visibleSurfaces(windows: DesktopWindow[], monitors: Monitor[], clearance = 90): Surface[] {
  const result: Surface[] = [];
  for (const [index, window] of windows.entries()) {
    let spans = [[window.x, window.x + window.width]];
    for (const cover of windows.slice(index + 1)) {
      if (cover.y <= window.y && cover.y + cover.height > window.y) {
        spans = spans.flatMap(([left = 0, right = 0]) => cover.x >= right || cover.x + cover.width <= left ? [[left, right]] : [[left, Math.min(right, cover.x)], [Math.max(left, cover.x + cover.width), right]].filter(([a = 0, b = 0]) => b > a));
      }
    }
    for (const m of monitors) {
      if (window.y < m.y + clearance || window.y > m.y + m.height) continue;
      for (const [a = 0, b = 0] of spans) {
        const x = Math.max(a, m.x), right = Math.min(b, m.x + m.width);
        if (right - x >= 48) result.push({ owner: window.owner, x, y: window.y, width: right - x, anchorX: window.x, kind: window.kind });
      }
    }
  }
  for (const [index, m] of monitors.entries()) result.push({ owner: -index - 1, x: m.x, y: m.y + m.height, width: m.width, kind: "floor" });
  return result;
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

export class CatWorld {
  x = 0; y = 0; vx = 0; vy = 0; direction = 1; phase = 0; time = 0;
  state: CatState = "sit";
  effect: Mood = "idle";
  effectUntil = 0;
  support: Surface | undefined;
  surfaces: Surface[] = [];
  goal: number | undefined;
  landing = 0;
  initialized = false;
  jumps = 0; landings = 0; falls = 0; rides = 0;
  readonly history = new Set<CatState>();
  private decisionAt = 2;
  private lastEvent = -100;
  private speed = 70;
  private crouch = 0;
  private pendingJump: { vx: number; vy: number } | undefined;
  constructor(private readonly random: () => number = Math.random) {}
  updateSurfaces(surfaces: Surface[]): void {
    this.surfaces = surfaces;
    if (!this.initialized && surfaces.length) {
      const candidates = surfaces.filter(s => s.kind === "window");
      this.support = (candidates.length ? candidates : surfaces)[0]!;
      this.x = this.support.x + this.support.width * .5;
      this.y = this.support.y;
      this.initialized = true;
    } else if (this.support) {
      const old = this.support;
      const candidates = surfaces.filter(s => s.owner === old.owner).sort((a, b) => Math.abs(a.x - old.x) - Math.abs(b.x - old.x));
      const dx = candidates[0] ? (candidates[0].anchorX ?? candidates[0].x) - (old.anchorX ?? old.x) : 0;
      const current = candidates.find(s => this.x + dx >= s.x + 16 && this.x + dx <= s.x + s.width - 16);
      if (current) {
        if (Math.abs(dx) + Math.abs(current.y - old.y) > .5) this.rides++;
        this.x += dx; this.y = current.y; this.support = current;
        if (this.goal !== undefined) this.goal += dx;
      } else {
        this.support = undefined; this.vy = 0; this.falls++; this.state = "fall"; this.pendingJump = undefined;
      }
    }
  }
  react(kind: Mood, phase: "start" | "end" = "start"): void {
    if (phase === "end") {
      if (this.effect === kind && kind !== "error") {
        this.effectUntil = Math.min(this.effectUntil, this.time + (kind === "approval" ? 0 : .8));
        this.decisionAt = Math.min(this.decisionAt, this.effectUntil + .3);
        if (kind === "approval") this.effect = "idle";
      }
      return;
    }
    this.lastEvent = this.time;
    if (this.effect === "approval" && this.effectUntil > this.time && kind !== "error" && kind !== "approval") return;
    if (this.effect === "error" && this.effectUntil > this.time && kind !== "approval") return;
    this.effect = kind;
    this.effectUntil = this.time + (kind === "approval" ? 40 : kind === "error" ? 4 : 3);
    this.goal = undefined; this.decisionAt = this.effectUntil + .5;
    if (kind === "click" && this.support && !this.pendingJump) { this.pendingJump = { vx: 0, vy: -340 }; this.crouch = .14; }
    if (this.state === "sleep") this.state = "wake";
  }
  jumpTo(surface: Surface, targetX = clamp(this.x + this.direction * 100, surface.x + 24, surface.x + surface.width - 24)): boolean {
    if (!this.support) return false;
    const vy = -660, discriminant = vy * vy + 2 * 1300 * (surface.y - this.y);
    if (discriminant <= 0) return false;
    const duration = (-vy + Math.sqrt(discriminant)) / 1300;
    const vx = (targetX - this.x) / duration;
    if (duration > 1.8 || Math.abs(vx) > 280) return false;
    this.pendingJump = { vx, vy }; this.crouch = .18; this.goal = undefined;
    this.decisionAt = this.time + 3;
    return true;
  }
  private chooseIdle(): void {
    if (!this.support) return;
    const candidates = this.surfaces.filter(s => s.owner !== this.support!.owner && s.kind === "window");
    if (this.random() < .55 && candidates.length) {
      const start = Math.floor(this.random() * candidates.length);
      for (let i = 0; i < candidates.length; i++) if (this.jumpTo(candidates[(i + start) % candidates.length]!)) return;
    }
    const choice = this.random();
    if (choice < .6 && this.support.width > 70) {
      this.goal = this.support.x + 24 + this.random() * (this.support.width - 48);
      this.speed = this.random() < .3 ? 170 : 65;
      this.decisionAt = this.time + 6;
    } else if (choice < .78 && this.time - this.lastEvent > 12) {
      this.state = "sleep"; this.decisionAt = this.time + 9 + this.random() * 12;
    } else {
      this.state = choice < .86 ? "groom" : choice < .94 ? "stretch" : "sit";
      this.decisionAt = this.time + 2 + this.random() * 3;
    }
  }
  step(dt: number): void {
    let remaining = clamp(dt, 0, .25);
    while (remaining > 0) { const d = Math.min(remaining, 1 / 120); this.integrate(d); remaining -= d; }
    this.history.add(this.state);
  }
  private integrate(dt: number): void {
    this.time += dt; this.landing *= Math.exp(-dt * 11);
    if (this.effect !== "idle" && this.effectUntil <= this.time) {
      this.effect = "idle";
      this.decisionAt = Math.min(this.decisionAt, this.time + .3);
      if (["observe", "type", "approval", "confused"].includes(this.state)) this.state = "sit";
    }
    if (!this.initialized) return;
    if (this.support) {
      if (this.pendingJump) {
        this.state = "crouch"; this.crouch -= dt; this.vx *= Math.exp(-dt * 15);
        if (this.crouch <= 0) { this.vx = this.pendingJump.vx; this.vy = this.pendingJump.vy; this.pendingJump = undefined; this.support = undefined; this.jumps++; this.state = "jump"; }
        return;
      }
      if (this.effect !== "idle") {
        this.state = ({ observe: "observe", type: "type", approval: "approval", error: "confused", click: "sit", activity: "sit" } as const)[this.effect];
        this.vx *= Math.exp(-dt * 15);
      } else if (this.time >= this.decisionAt) this.chooseIdle();
      if (this.goal !== undefined) {
        const distance = this.goal - this.x;
        if (Math.abs(distance) < 3) { this.goal = undefined; this.state = "sit"; this.decisionAt = this.time + 1; }
        else {
          this.direction = Math.sign(distance);
          const desired = this.direction * Math.min(this.speed, Math.sqrt(840 * Math.abs(distance)));
          this.vx += clamp(desired - this.vx, -650 * dt, 650 * dt);
          this.state = Math.abs(this.vx) > 105 ? "run" : "walk";
        }
      } else this.vx *= Math.exp(-dt * 14);
      this.x += this.vx * dt; this.phase += Math.abs(this.vx) * dt / 23;
      if (this.x < this.support.x + 16 || this.x > this.support.x + this.support.width - 16) {
        this.x = clamp(this.x, this.support.x + 16, this.support.x + this.support.width - 16);
        this.vx = 0; this.goal = undefined; this.direction *= -1;
      }
    } else {
      const oldY = this.y;
      this.vy += 1300 * dt; this.x += this.vx * dt; this.y += this.vy * dt;
      this.phase += Math.abs(this.vx) * dt / 23;
      this.state = this.vy < -20 ? "jump" : "fall";
      if (this.vy >= 0) {
        const crossed = this.surfaces.filter(s => oldY <= s.y && s.y <= this.y && this.x >= s.x + 10 && this.x <= s.x + s.width - 10).sort((a, b) => a.y - b.y);
        if (crossed[0]) {
          this.landing = Math.min(1, this.vy / 650); this.support = crossed[0]; this.y = this.support.y; this.vy = 0;
          this.goal = undefined; this.landings++; this.state = "land"; this.decisionAt = this.time + .7;
        }
      }
      const floors = this.surfaces.filter(s => s.kind === "floor");
      if (floors.length) {
        const left = Math.min(...floors.map(s => s.x)), right = Math.max(...floors.map(s => s.x + s.width));
        if (this.x < left + 16 || this.x > right - 16) { this.x = clamp(this.x, left + 16, right - 16); this.vx *= -.45; }
        const bottom = Math.max(...floors.map(s => s.y));
        if (this.y > bottom + 100) { const floor = floors.reduce((a, b) => Math.abs(this.x - (a.x + a.width / 2)) < Math.abs(this.x - (b.x + b.width / 2)) ? a : b); this.x = clamp(this.x, floor.x + 24, floor.x + floor.width - 24); this.y = floor.y - 80; this.vy = 0; }
      }
    }
  }
}
