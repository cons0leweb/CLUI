import type { CatWorld } from "./World.js";
export const PALETTE = [0, 0x080b12, 0x191e2b, 0x30384b, 0xffb63d, 0xffdf83, 0x06080c, 0x975d71, 0xb8d1dc, 0x6fc8c1, 0xfff2cf, 0x623e52, 0xb77830] as const;
export interface PixelFrame { width: number; height: number; pixels: Uint8Array; feetX: number; feetY: number }
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export class CatAnimator {
  private sleep = 0;
  private sit = 1;
  private lift = 0;
  private tail = 0;
  private stretch = 0;
  render(cat: CatWorld, dt: number, pointer?: { x: number; y: number }): PixelFrame {
    const width = 64, height = 60, pixels = new Uint8Array(width * height);
    const blend = 1 - Math.exp(-Math.min(dt, .1) * 10);
    this.sleep = lerp(this.sleep, cat.state === "sleep" ? 1 : 0, blend);
    this.sit = lerp(this.sit, ["sit", "groom", "observe", "type", "approval", "confused", "wake"].includes(cat.state) ? 1 : 0, blend);
    this.lift = lerp(this.lift, cat.state === "crouch" ? 3 : cat.state === "jump" ? -2 : 0, blend);
    this.tail = lerp(this.tail, Math.sin(cat.time * 2.4) * 2 + (cat.vx / 90), blend);
    this.stretch = lerp(this.stretch, cat.state === "stretch" ? 1 : 0, blend);
    const pixel = (x: number, y: number, color: number) => {
      x = Math.round(x); y = Math.round(y);
      if (cat.direction < 0) x = width - 1 - x;
      if (x >= 0 && x < width && y >= 0 && y < height) pixels[y * width + x] = color;
    };
    const rect = (x: number, y: number, w: number, h: number, color: number) => {
      for (let py = 0; py < Math.round(h); py++) for (let px = 0; px < Math.round(w); px++) pixel(x + px, y + py, color);
    };
    const ellipse = (x: number, y: number, rx: number, ry: number, color: number) => {
      for (let py = -Math.ceil(ry); py <= Math.ceil(ry); py++) for (let px = -Math.ceil(rx); px <= Math.ceil(rx); px++) if (px * px / (rx * rx) + py * py / (ry * ry) <= 1) pixel(x + px, y + py, color);
    };
    const line = (x: number, y: number, tx: number, ty: number, color: number, thickness = 1) => {
      const steps = Math.max(Math.abs(tx - x), Math.abs(ty - y), 1);
      for (let i = 0; i <= steps; i++) rect(lerp(x, tx, i / steps), lerp(y, ty, i / steps), thickness, thickness, color);
    };
    const moving = cat.state === "walk" || cat.state === "run";
    const bounce = moving ? Math.sin(cat.phase * Math.PI * 2) * (cat.state === "run" ? 1.5 : .6) : Math.sin(cat.time * 2) * .35;
    const bodyY = 40 + this.lift + bounce + cat.landing * 3 + this.sleep * 6;
    const bodyH = lerp(9, 6, this.sleep) - cat.landing * 2;
    const headY = lerp(26, 42, this.sleep) + this.lift + bounce + cat.landing * 2 + this.stretch * 8;
    const headX = lerp(39, 43, this.sleep) + this.stretch * 4;
    // Tail inertia and four independently phased feet keep locomotion from sliding.
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      const x = 25 - t * 15 + Math.sin(t * 3 + cat.time * 2) * 1.5;
      const y = bodyY - 1 - Math.sin(t * 1.8) * (10 + this.sit * 5) + this.tail * t;
      rect(x, y, 3, 3, i > 10 ? 2 : 1);
    }
    for (let i = 0; i < 4; i++) {
      const wave = moving ? Math.sin(cat.phase * Math.PI * 2 + (i % 2) * Math.PI) : 0;
      const x = [25, 30, 39, 44][i]! + wave * (cat.state === "run" ? 4 : 2);
      const footY = 52 - Math.max(0, wave) * (moving ? 3 : 0) - (cat.support ? 0 : 3 + i % 2);
      rect(x, bodyY + 3, 3, Math.max(2, footY - bodyY - 2), i % 2 ? 1 : 2);
      rect(x - 1, footY - 2, 5, 3, i % 2 ? 2 : 3);
      pixel(x, footY, 2);
    }
    ellipse(32, bodyY, 13 + this.sleep * 3 + cat.landing * 2 + this.stretch * 3, Math.max(4, bodyH), 1);
    ellipse(30, bodyY + 1, 8, Math.max(4, bodyH - 1), 2);
    if (this.sit > .2) ellipse(26, 45 + this.lift, 7, 6 * this.sit + 1, 1);
    ellipse(headX, headY, 12, lerp(11, 8, this.sleep), 1);
    ellipse(headX - 1, headY - 1, 10, lerp(8, 6, this.sleep), 2);
    ellipse(headX - 8, headY + 4, 5, 5, 1);
    ellipse(headX + 8, headY + 4, 5, 5, 1);
    ellipse(headX, headY + 5, 7, 4, 2);
    const earFlick = Math.sin(cat.time * .7) > .98 ? 2 : 0;
    for (let i = 0; i < 9; i++) {
      rect(headX - 10, headY - 15 + i + earFlick, Math.min(8, i + 2), 1, 1);
      rect(headX + 9 - Math.min(7, i), headY - 15 + i, Math.min(8, i + 2), 1, 1);
    }
    line(headX - 8, headY - 11, headX - 5, headY - 7, 11, 2);
    line(headX + 7, headY - 11, headX + 4, headY - 7, 11, 2);
    const blinking = this.sleep > .6 || Math.sin(cat.time * .77) > .997;
    const look = pointer ? Math.max(-1, Math.min(1, (pointer.x - cat.x) / 160)) * cat.direction : 0;
    for (const offset of [-4, 4]) {
      if (blinking) line(headX + offset - 2, headY, headX + offset + 1, headY + (this.sleep > .6 ? 0 : 1), 4);
      else {
        ellipse(headX + offset, headY, 3, 3, 12);
        ellipse(headX + offset, headY, 3, 2, 4);
        rect(headX + offset - 1 + Math.round(look), headY - 1, 2, 3, 6);
        pixel(headX + offset - 1, headY - 2, 10);
        pixel(headX + offset + 1, headY + 1, 5);
      }
    }
    rect(headX, headY + 4, 2, 1, 7);
    pixel(headX, headY + 5, 7); pixel(headX - 1, headY + 6, 3); pixel(headX + 2, headY + 6, 3);
    line(headX - 7, headY + 3, headX - 12, headY + 2, 3);
    line(headX + 8, headY + 3, headX + 12, headY + 2, 3);
    if (cat.state === "type") {
      rect(32, 49, 22, 3, 3); rect(33, 48, 20, 1, 8);
      for (let i = 0; i < 2; i++) rect(36 + i * 9, 43 + Math.round(Math.sin(cat.time * 19 + i * Math.PI) * 2), 5, 4, 2);
    }
    if (cat.state === "groom") {
      rect(headX - 4, headY + 3 + Math.sin(cat.time * 8) * 2, 5, 3, 3);
      pixel(headX + 1, headY + 6, 7);
    }
    if (cat.effect === "observe") {
      ellipse(52, 23, 6, 6, 8); ellipse(52, 23, 4, 4, 9); ellipse(52, 23, 3, 3, 2);
      line(48, 28, 44, 34, 3, 2);
    }
    if (cat.effect === "approval") {
      const y = 4 + Math.sin(cat.time * 4);
      line(31, y, 37, y, 4, 2); line(37, y, 39, y + 3, 4, 2); line(38, y + 4, 34, y + 7, 4, 2); rect(34, y + 10, 2, 2, 5);
    }
    if (cat.effect === "error") {
      for (let i = 0; i < 3; i++) {
        const a = cat.time * 2 + i * Math.PI * 2 / 3, x = 35 + Math.cos(a) * 12, y = 10 + Math.sin(a) * 4;
        line(x - 2, y, x + 2, y, 4); line(x, y - 2, x, y + 2, 5);
      }
    }
    if (this.sleep > .6) {
      const y = 18 - (cat.time % 2) * 3;
      line(45, y, 49, y, 8); line(49, y, 45, y + 4, 8); line(45, y + 4, 49, y + 4, 8);
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
