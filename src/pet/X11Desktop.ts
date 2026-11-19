import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { PALETTE, type PixelFrame } from "./CatAnimator.js";
import { visibleSurfaces, type DesktopWindow, type Monitor, type Surface } from "./World.js";
interface Client extends EventEmitter { [key: string]: unknown; AllocID(): number; terminate(): void; require(name: string, cb: (error: Error | null, extension: Extension) => void): void }
interface Extension { [key: string]: unknown }
interface Display { client: Client; screen: Array<{ root: number; root_depth: number; pixel_width: number; pixel_height: number }> }
interface Property { data: Buffer; format: number }
export class X11Desktop {
  readonly window: number;
  readonly root: number;
  readonly monitors: Monitor[] = [];
  pointer = { x: 0, y: 0 };
  private readonly atoms = new Map<string, number>();
  private readonly gc: number;
  private readonly pixmap: number;
  private readonly shape: Extension;
  private closed = false;
  private lastShape = "";
  private lastPixels = Buffer.alloc(0);
  private readonly depth: number;
  private lastPosition = "";
  private mapped = false;
  private raisedAt = 0;
  private readonly subscribed = new Set<number>();
  private constructor(readonly client: Client, screen: Display["screen"][number], shape: Extension, readonly scale: number) {
    this.root = screen.root; this.shape = shape; this.depth = screen.root_depth;
    if (this.depth !== 24 && this.depth !== 32) throw new Error("CLUI Pet requires a 24/32-bit TrueColor X11 screen");
    this.monitors.push({ x: 0, y: 0, width: screen.pixel_width, height: screen.pixel_height });
    this.window = client.AllocID(); this.gc = client.AllocID(); this.pixmap = client.AllocID();
    this.send("CreateWindow", this.window, this.root, 0, 0, 64 * scale, 60 * scale, 0, 0, 1, 0, { overrideRedirect: 1, backgroundPixel: 0, eventMask: 32768 | (1 << 15) });
    this.shapeRectangles(2, []);
    this.shapeRectangles(0, []);
    this.send("CreatePixmap", this.pixmap, this.root, screen.root_depth, 64 * scale, 60 * scale);
    this.send("CreateGC", this.gc, this.pixmap, { foreground: 0, graphicsExposures: 0 });
    this.send("ChangeProperty", 0, this.window, 39, 31, 8, Buffer.from("CLUI Pet"));
    this.send("ChangeWindowAttributes", this.root, { eventMask: (1 << 22) | (1 << 19) });
  }
  static async connect(scale = 2): Promise<X11Desktop> {
    const x11 = createRequire(import.meta.url)("x11") as { createClient(cb: (error: Error | null, display: Display) => void): Client };
    const display = await new Promise<Display>((resolve, reject) => {
      const client = x11.createClient((error, value) => error ? reject(error) : resolve(value));
      client.on("error", () => {});
    });
    try {
      const shape = await new Promise<Extension>((resolve, reject) => display.client.require("shape", (error, extension) => error ? reject(error) : resolve(extension)));
      const version = await new Promise<number[]>((resolve, reject) => (shape.QueryVersion as Function)((error: Error | null, value: number[]) => error ? reject(error) : resolve(value)));
      if (version[0]! < 1 || (version[0] === 1 && version[1]! < 1)) throw new Error("X11 SHAPE 1.1 is required");
      const desktop = new X11Desktop(display.client, display.screen[0]!, shape, scale);
      const type = await desktop.atom("_NET_WM_WINDOW_TYPE"), dnd = await desktop.atom("_NET_WM_WINDOW_TYPE_DND");
      desktop.send("ChangeProperty", 0, desktop.window, type, 4, 32, [dnd]);
      const hints = Buffer.alloc(36); hints.writeUInt32LE(1, 0); // InputHint=false; override-redirect also keeps the WM from activating us.
      desktop.send("ChangeProperty", 0, desktop.window, await desktop.atom("WM_HINTS"), await desktop.atom("WM_HINTS"), 32, hints);
      try {
        const xinerama = await new Promise<Extension>((resolve, reject) => display.client.require("xinerama", (error, extension) => error ? reject(error) : resolve(extension)));
        const monitors = await new Promise<Monitor[]>((resolve, reject) => (xinerama.QueryScreens as Function)((error: Error | null, value: Monitor[]) => error ? reject(error) : resolve(value)));
        if (monitors.length) desktop.monitors.splice(0, desktop.monitors.length, ...monitors);
      } catch { /* Single-root fallback still provides a usable floor. */ }
      return desktop;
    } catch (error) { display.client.terminate(); throw error; }
  }
  send(method: string, ...args: unknown[]): void { (this.client[method] as (...args: unknown[]) => void).apply(this.client, args); }
  query<T>(method: string, ...args: unknown[]): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`X11 ${method} timed out`)), 1500);
      this.send(method, ...args, (error: Error | null, value: T) => { clearTimeout(timer); error ? reject(error) : resolve(value); });
    });
  }
  private async atom(name: string): Promise<number> {
    if (!this.atoms.has(name)) this.atoms.set(name, await this.query<number>("InternAtom", false, name));
    return this.atoms.get(name)!;
  }
  private async property(window: number, name: string): Promise<number[]> {
    const property = await this.query<Property>("GetProperty", 0, window, await this.atom(name), 0, 0, 2048);
    if (property.format !== 32) return [];
    return Array.from({ length: property.data.length / 4 }, (_, i) => property.data.readUInt32LE(i * 4));
  }
  async snapshot(): Promise<Surface[]> {
    const [stack, workspace, hidden, dock, excluded] = await Promise.all([
      this.property(this.root, "_NET_CLIENT_LIST_STACKING"), this.property(this.root, "_NET_CURRENT_DESKTOP"),
      this.atom("_NET_WM_STATE_HIDDEN"), this.atom("_NET_WM_WINDOW_TYPE_DOCK"),
      Promise.all(["DESKTOP", "DND", "TOOLTIP", "NOTIFICATION", "POPUP_MENU", "DROPDOWN_MENU"].map(type => this.atom(`_NET_WM_WINDOW_TYPE_${type}`))),
    ]);
    const windows: DesktopWindow[] = [];
    // Bounded batches avoid flooding X11 when a desktop has many windows.
    for (let offset = 0; offset < Math.min(stack.length, 256); offset += 12) {
      const batch = await Promise.all(stack.slice(offset, offset + 12).map(async owner => {
        if (owner === this.window) return undefined;
        try {
          const [attributes, geometry, position, types, states, desktop, frame] = await Promise.all([
            this.query<{ mapState: number; overrideRedirect: number }>("GetWindowAttributes", owner),
            this.query<{ width: number; height: number }>("GetGeometry", owner),
            this.query<{ destX: number; destY: number }>("TranslateCoordinates", owner, this.root, 0, 0),
            this.property(owner, "_NET_WM_WINDOW_TYPE"), this.property(owner, "_NET_WM_STATE"), this.property(owner, "_NET_WM_DESKTOP"), this.property(owner, "_NET_FRAME_EXTENTS"),
          ]);
          if (attributes.mapState !== 2 || attributes.overrideRedirect || states.includes(hidden) || types.some(type => excluded.includes(type))) return undefined;
          if (desktop[0] !== undefined && desktop[0] !== 0xffffffff && workspace[0] !== undefined && desktop[0] !== workspace[0]) return undefined;
          if (!this.subscribed.has(owner)) { this.send("ChangeWindowAttributes", owner, { eventMask: (1 << 17) | (1 << 22) }); this.subscribed.add(owner); }
          return { owner, x: position.destX - (frame[0] ?? 0), y: position.destY - (frame[2] ?? 0), width: geometry.width + (frame[0] ?? 0) + (frame[1] ?? 0), height: geometry.height + (frame[2] ?? 0) + (frame[3] ?? 0), kind: types.includes(dock) ? "panel" as const : "window" as const };
        } catch { return undefined; } // A close/minimize can race the read-only geometry query.
      }));
      windows.push(...batch.filter((window): window is DesktopWindow => window !== undefined));
    }
    const alive = new Set(stack);
    for (const owner of this.subscribed) if (!alive.has(owner)) this.subscribed.delete(owner);
    const pointer = await this.query<{ rootX: number; rootY: number }>("QueryPointer", this.root);
    this.pointer = { x: pointer.rootX, y: pointer.rootY };
    return visibleSurfaces(windows, this.monitors, 46 * this.scale);
  }
  private shapeRectangles(kind: number, rectangles: number[][]): void { (this.shape.Rectangles as Function)(0, kind, this.window, 0, 0, rectangles, 0); }
  invalidate(): void { this.lastPixels = Buffer.alloc(0); }
  draw(frame: PixelFrame, x: number, y: number): void {
    const pixels = Buffer.from(frame.pixels.buffer, frame.pixels.byteOffset, frame.pixels.byteLength);
    if (!pixels.equals(this.lastPixels)) {
      const shape: number[][] = [];
      for (let y = 0; y < frame.height; y++) {
        for (let x = 0; x < frame.width;) {
          if (!frame.pixels[y * frame.width + x]) { x++; continue; }
          const start = x;
          while (x < frame.width && frame.pixels[y * frame.width + x]) x++;
          shape.push([start * this.scale, y * this.scale, (x - start) * this.scale, this.scale]);
        }
      }
      const signature = JSON.stringify(shape);
      if (signature !== this.lastShape) { this.shapeRectangles(0, shape); this.lastShape = signature; }
      const width = frame.width * this.scale, height = frame.height * this.scale;
      const image = Buffer.alloc(width * height * 4);
      const packed = new Uint32Array(image.buffer, image.byteOffset, width * height);
      for (let y = 0; y < frame.height; y++) {
        const row = y * this.scale * width;
        for (let x = 0; x < frame.width; x++) {
          const color = PALETTE[frame.pixels[y * frame.width + x]!] ?? 0;
          for (let sx = 0; sx < this.scale; sx++) packed[row + x * this.scale + sx] = color;
        }
        for (let sy = 1; sy < this.scale; sy++) image.copy(image, (row + sy * width) * 4, row * 4, (row + width) * 4);
      }
      this.send("PutImage", 2, this.pixmap, this.gc, width, height, 0, 0, 0, this.depth, image);
      this.send("CopyArea", this.pixmap, this.window, this.gc, 0, 0, 0, 0, width, height);
      this.lastPixels = Buffer.from(pixels);
    }
    const px = Math.round(x - frame.feetX * this.scale), py = Math.round(y - frame.feetY * this.scale);
    const position = `${px},${py}`;
    if (position !== this.lastPosition) { this.send("ConfigureWindow", this.window, { x: px, y: py }); this.lastPosition = position; }

    if (!this.mapped) { this.send("MapWindow", this.window); this.mapped = true; }
    if (Date.now() - this.raisedAt > 1000) { this.send("ConfigureWindow", this.window, { stackMode: 0 }); this.raisedAt = Date.now(); }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.send("FreeGC", this.gc); this.send("FreePixmap", this.pixmap); this.send("DestroyWindow", this.window); this.client.terminate();
  }
}
