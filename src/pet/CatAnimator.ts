import type { CatWorld } from "./World.js";

export const PALETTE = [
  0, 0x080b12, 0x191e2b, 0x30384b, 0xffb63d, 0xffdf83, 0x06080c, 0x975d71,
  0xb8d1dc, 0x6fc8c1, 0xfff2cf, 0x623e52, 0xb77830,
  0x4b5873, // 13 rim light
  0xd9788f, // 14 tongue
] as const;

export interface PixelFrame { width: number; height: number; pixels: Uint8Array; feetX: number; feetY: number }

const C = {
  ink: 1, fur: 2, light: 3, amber: 4, gold: 5, shade: 6, pink: 7, ice: 8,
  teal: 9, cream: 10, plum: 11, bronze: 12, rim: 13, tongue: 14,
} as const;

const SIT_STATES = new Set(["sit", "groom", "observe", "type", "approval", "confused", "wake"]);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class CatAnimator {
  private sleep = 0;
  private sit = 1;
  private lift = 0;
  private tail = 0;
  private stretch = 0;
  private earBack = 0;
  private tilt = 0;
  private look = 0;

  render(cat: CatWorld, dt: number, pointer?: { x: number; y: number }): PixelFrame {
    const width = 64, height = 60, pixels = new Uint8Array(width * height);
    const blend = 1 - Math.exp(-Math.min(dt, .1) * 10);
    const state = cat.state;
    const moving = state === "walk" || state === "run";

    this.sleep = lerp(this.sleep, state === "sleep" ? 1 : 0, blend);
    this.sit = lerp(this.sit, SIT_STATES.has(state) ? 1 : 0, blend);
    this.lift = lerp(this.lift, state === "crouch" ? 3 : state === "jump" ? -2 : 0, blend);
    this.tail = lerp(this.tail, Math.sin(cat.time * 2.4) * 2 + Math.abs(cat.vx) / 90, blend);
    this.stretch = lerp(this.stretch, state === "stretch" ? 1 : 0, blend);
    this.earBack = lerp(this.earBack, state === "run" ? 1 : state === "crouch" ? .8 : state === "jump" ? .6 : 0, blend);
    this.tilt = lerp(this.tilt, state === "confused" ? 1 : 0, blend);
    const lookTarget = pointer ? clamp((pointer.x - cat.x) / 160, -1, 1) * cat.direction : 0;
    this.look = lerp(this.look, lookTarget, blend);
    const { sleep, sit, stretch, tilt, earBack } = this;

    let mirror = cat.direction < 0;
    const anchor = (x: number) => (cat.direction < 0 ? width - 1 - x : x);
    const pixel = (x: number, y: number, color: number) => {
      x = Math.round(x); y = Math.round(y);
      if (mirror) x = width - 1 - x;
      if (x >= 0 && x < width && y >= 0 && y < height) pixels[y * width + x] = color;
    };
    const rect = (x: number, y: number, w: number, h: number, color: number) => {
      for (let py = 0; py < Math.round(h); py++) for (let px = 0; px < Math.round(w); px++) pixel(x + px, y + py, color);
    };
    const ellipse = (x: number, y: number, rx: number, ry: number, color: number) => {
      rx = Math.max(rx, .5); ry = Math.max(ry, .5);
      for (let py = -Math.ceil(ry); py <= Math.ceil(ry); py++)
        for (let px = -Math.ceil(rx); px <= Math.ceil(rx); px++)
          if (px * px / (rx * rx) + py * py / (ry * ry) <= 1) pixel(x + px, y + py, color);
    };
    const line = (x: number, y: number, tx: number, ty: number, color: number, thickness = 1) => {
      const steps = Math.max(Math.abs(tx - x), Math.abs(ty - y), 1);
      for (let i = 0; i <= steps; i++) rect(lerp(x, tx, i / steps), lerp(y, ty, i / steps), thickness, thickness, color);
    };
    const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, color: number) => {
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (!area) return;
      const x0 = Math.floor(Math.min(ax, bx, cx)), x1 = Math.ceil(Math.max(ax, bx, cx));
      const y0 = Math.floor(Math.min(ay, by, cy)), y1 = Math.ceil(Math.max(ay, by, cy));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const w0 = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / area;
        const w1 = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 >= -.001 && w1 >= -.001 && w2 >= -.001) pixel(x, y, color);
      }
    };
    const ear = (ax: number, ay: number, bx: number, by: number, tx: number, ty: number) => {
      tri(ax, ay, bx, by, tx, ty, C.ink);
      const cx = (ax + bx + tx) / 3, cy = (ay + by + ty) / 3 + 1.5, k = .5;
      tri(cx + (ax - cx) * k, cy + (ay - cy) * k, cx + (bx - cx) * k, cy + (by - cy) * k, cx + (tx - cx) * k, cy + (ty - cy) * k, C.plum);
    };
    const stamp = (ox: number, oy: number, rows: string[], colors: Record<string, number>) =>
      rows.forEach((row, y) => [...row].forEach((ch, x) => { const c = colors[ch]; if (c) pixel(ox + x, oy + y, c); }));

    const bounce = moving ? Math.sin(cat.phase * Math.PI * 2) * (state === "run" ? 1.5 : .6) : Math.sin(cat.time * 2) * .35;
    const breath = sleep * Math.sin(cat.time * 1.8) * .5;
    const bodyY = 40 + this.lift + bounce + cat.landing * 3 + sleep * 6;
    const bodyH = lerp(9, 6, sleep) - cat.landing * 2 + breath;
    const headY = lerp(26, 42, sleep) + this.lift + bounce + cat.landing * 2 + stretch * 8;
    const headX = lerp(39, 43, sleep) + stretch * 4 + tilt;

    //const air = cat.support ? 0 : 1;
    //const shW = 17 + sleep * 3 - air * 4;
    //for (let py = -2; py <= 2; py++) for (let px = -Math.ceil(shW); px <= Math.ceil(shW); px++) {
      //const d = (px * px) / (shW * shW) + (py * py) / 6.76;
      //if (d <= 1 && (d < .45 || ((px + py) & 1) === 0)) pixel(32 + px, 53 + py, C.shade);
    //}

    
    const drawTail = () => {
      for (let i = 0; i < 14; i++) {
        const t = i / 13;
        const ax = 25 - t * 15 + Math.sin(t * 3 + cat.time * 2) * 1.5;
        const ay = bodyY - 1 - Math.sin(t * 1.8) * (10 + sit * 5) + this.tail * t + Math.sin(cat.time * 2.6 - t * 3) * 1.2 * t;
        const sx = 19 + t * 18;
        const sy = bodyY + 2 + Math.sin(t * Math.PI / 2) * 2.5;
        const x = lerp(ax, sx, sleep), y = lerp(ay, sy, sleep);
        const ring = i % 4 === 3 || i >= 12;
        rect(x, y, 3, 3, ring ? C.fur : C.ink);
        if (!ring) pixel(x + 1, y, C.fur);
      }
    };
    if (sleep < .5) drawTail();


    const legs = [
      { x: 24, far: true, off: 0 }, { x: 40, far: true, off: Math.PI },
      { x: 29, far: false, off: Math.PI }, { x: 45, far: false, off: 0 },
    ];
    for (const leg of legs) {
      const wave = moving ? Math.sin(cat.phase * Math.PI * 2 + leg.off) : 0;
      const reach = leg.x > 34 ? stretch * 4 : 0;
      const x = leg.x + wave * (state === "run" ? 4 : 2) + reach;
      const lifted = Math.max(0, wave) * (moving ? (state === "run" ? 4 : 3) : 0);
      const footY = 52 - lifted - (cat.support ? 0 : 3 + (leg.far ? 1 : 0));
      rect(x, bodyY + 3, 3, Math.max(2, footY - bodyY - 2), leg.far ? C.ink : C.fur);
      rect(x - 1, footY - 2, 5, 3, leg.far ? C.fur : C.light);
      pixel(x + 1, footY, C.ink);
    }


    const bodyRx = 13 + sleep * 3 + cat.landing * 2 + stretch * 3;
    const bodyRy = Math.max(4, bodyH);
    ellipse(32, bodyY, bodyRx, bodyRy, C.ink);
    ellipse(30, bodyY + 1, 8, Math.max(4, bodyH - 1), C.fur);
    for (const dx of [-8, -4, 0, 4]) { 
      const top = bodyY - bodyRy * Math.sqrt(Math.max(0, 1 - (dx / bodyRx) ** 2));
      line(32 + dx, top + 1, 32 + dx + 1, top + 4, C.light);
    }
    if (sit > .2) {
      ellipse(26, 45 + this.lift, 7, 6 * sit + 1, C.ink);
      ellipse(25, 44 + this.lift, 4.5, 4 * sit + .5, C.fur);
    }


    ellipse(headX, headY, 12, lerp(11, 8, sleep), C.ink);
    ellipse(headX - 1, headY - 1, 10, lerp(8, 6, sleep), C.fur);
    ellipse(headX - 8, headY + 4, 5, 5, C.ink);
    ellipse(headX + 8, headY + 4, 5, 5, C.ink);
    ellipse(headX, headY + 5, 7, 4, C.fur);

    const flick = Math.sin(cat.time * .7) > .98 ? 2 : 0;
    ear(headX - 12, headY - 4, headX - 2, headY - 9,
      headX - 10 - earBack * 3 - tilt * 2, headY - 17 + earBack * 4 + tilt * 4 + flick);
    ear(headX + 12, headY - 4, headX + 2, headY - 9,
      headX + 10 - earBack * 5, headY - 17 + earBack * 4 - tilt);


    const bt = cat.time % 3.9;
    const blinking = bt < .13 || (bt > .36 && bt < .46 && Math.floor(cat.time / 3.9) % 3 === 0);
    const lid = Math.round(clamp(sleep * 5, 0, 3));
    const px = Math.round(this.look * 1.5);
    for (const off of [-5, 5]) {
      const ex = headX + off;
      if (sleep > .6 || blinking) {
        const col = sleep > .6 ? C.rim : C.amber;
        pixel(ex - 2, headY, col); pixel(ex - 1, headY + 1, col); pixel(ex, headY + 1, col);
        pixel(ex + 1, headY + 1, col); pixel(ex + 2, headY, col);
      } else {
        ellipse(ex, headY, 3, 3, C.bronze);
        ellipse(ex, headY, 3, 2, C.amber);
        rect(ex - 1 + px, headY - 1, 2, 3, C.shade);
        pixel(ex - 1, headY - 2, C.cream);
        pixel(ex + 1, headY + 1, C.gold);
        if (lid > 0) rect(ex - 3, headY - 3, 7, lid, C.ink);
      }
    }

    rect(headX - 1, headY + 4, 3, 1, C.pink);
    pixel(headX, headY + 5, C.pink);
    if (sleep < .6) {
      if (state === "confused") line(headX - 2, headY + 7, headX + 2, headY + 7, C.light);
      else {
        pixel(headX - 2, headY + 6, C.light); pixel(headX - 1, headY + 7, C.light); pixel(headX, headY + 6, C.light);
        pixel(headX + 1, headY + 7, C.light); pixel(headX + 2, headY + 6, C.light);
      }
    }

    if (state === "type") {
      rect(32, 49, 22, 3, C.light); rect(33, 48, 20, 1, C.ice);
      for (let k = 0; k < 7; k++) pixel(34 + k * 3, 50, Math.sin(cat.time * 12 + k) > .3 ? C.teal : C.ink);
      for (let i = 0; i < 2; i++) rect(36 + i * 9, 43 + Math.round(Math.sin(cat.time * 19 + i * Math.PI) * 2), 5, 4, C.fur);
    }
    if (state === "groom") {
      const py = headY + 5 + Math.sin(cat.time * 8) * 2;
      ellipse(headX - 4, py, 3, 4, C.ink);
      ellipse(headX - 4, py - 1, 2, 2.5, C.light);
      rect(headX, headY + 7, 2, 2, C.tongue);
    }

    const src = pixels.slice();
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const c = src[y * width + x]!;
      if ((c === C.ink || c === C.fur) && (y === 0 || src[(y - 1) * width + x] === 0)) pixels[y * width + x] = C.rim;
    }


    if (sleep < .6) {
      line(headX - 8, headY + 4, headX - 14, headY + 2, C.rim); line(headX - 8, headY + 5, headX - 14, headY + 6, C.rim);
      line(headX + 8, headY + 4, headX + 14, headY + 2, C.rim); line(headX + 8, headY + 5, headX + 14, headY + 6, C.rim);
    }

    if (sleep >= .5) drawTail();

    if (cat.effect === "observe") {
      line(48, 28, 44, 34, C.bronze, 2);
      ellipse(52, 23, 6, 6, C.ice); ellipse(52, 23, 4.5, 4.5, C.ink); ellipse(52, 23, 3.5, 3.5, C.fur);
      pixel(50, 21, C.cream); pixel(51, 20, C.cream); pixel(54, 26, C.teal);
    }

    mirror = false; 
    if (cat.effect === "approval") {
      const oy = Math.max(0, Math.round(1 + Math.sin(cat.time * 4)));
      stamp(anchor(headX + 13) - 3, oy, [
        ".aaaa.", "aa..aa", "aa..aa", "...aa.", "..aa..", "..aa..", "......", "..bb..", "..bb..",
      ], { a: C.amber, b: C.gold });
    }
    if (cat.effect === "error") {
      const cy0 = Math.max(4, headY - 18), cx0 = anchor(headX - 2);
      for (let i = 0; i < 3; i++) {
        const a = cat.time * 2 + i * Math.PI * 2 / 3, x = cx0 + Math.cos(a) * 12, y = cy0 + Math.sin(a) * 4;
        line(x - 2, y, x + 2, y, C.amber); line(x, y - 2, x, y + 2, C.gold);
      }
    }
    if (sleep > .6) {
      for (const k of [0, 1]) {
        const t = (cat.time * .5 + k * .5) % 1;
        if (t > .85) continue;
        const n = t < .5 ? 3 : 5;
        const zx = anchor(headX + 6 + t * 5), zy = Math.max(0, headY - 12 - t * 12);
        const col = t < .6 ? C.ice : C.teal;
        line(zx, zy, zx + n - 1, zy, col); line(zx + n - 1, zy, zx, zy + n - 1, col); line(zx, zy + n - 1, zx + n - 1, zy + n - 1, col);
      }
    }

    return { width, height, pixels, feetX: cat.direction < 0 ? 31 : 32, feetY: 52 };
  }
}

export function pixelRuns(frame: PixelFrame, scale: number): Map<number, number[][]> {
  const groups = new Map<number, number[][]>();
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width;) {
      const color = frame.pixels[y * frame.width + x]!;
      let right = x + 1;
      while (right < frame.width && frame.pixels[y * frame.width + right] === color) right++;
      if (color) { const group = groups.get(color) ?? []; group.push([x * scale, y * scale, (right - x) * scale, scale]); groups.set(color, group); }
      x = right;
    }
  }
  return groups;
}