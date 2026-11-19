import { describe, expect, it } from "vitest";
import { CatWorld, visibleSurfaces, type Surface } from "../src/pet/World.js";
import { CatAnimator, pixelRuns } from "../src/pet/CatAnimator.js";
import { parsePetEvent } from "../src/pet/VisualEventReceiver.js";
const floor: Surface = { owner: -1, x: 0, y: 900, width: 1200, kind: "floor" };
const window: Surface = { owner: 1, x: 100, y: 400, width: 400, kind: "window" };
const advance = (world: CatWorld, seconds: number) => { for (let t = 0; t < seconds; t += 1 / 60) world.step(1 / 60); };

describe("pet desktop physics", () => {
  it("subtracts occluded edges and keeps monitor floors and panels", () => {
    const surfaces = visibleSurfaces([{ owner: 1, x: 100, y: 300, width: 600, height: 400, kind: "window" }, { owner: 2, x: 300, y: 200, width: 200, height: 400, kind: "window" }, { owner: 3, x: 0, y: 868, width: 1200, height: 32, kind: "panel" }], [{ x: 0, y: 0, width: 1200, height: 900 }]);
    expect(surfaces.filter(s => s.owner === 1).map(s => [s.x, s.width])).toEqual([[100, 200], [500, 200]]);
    expect(surfaces.some(s => s.kind === "panel")).toBe(true);
    expect(surfaces.at(-1)).toMatchObject({ kind: "floor", y: 900 });
  });
  it("rides a moved supporting window and falls when it closes", () => {
    const world = new CatWorld(); world.updateSurfaces([window, floor]);
    const x = world.x;
    world.updateSurfaces([{ ...window, x: 180, y: 350 }, floor]);
    expect(world.x).toBe(x + 80); expect(world.y).toBe(350); expect(world.rides).toBe(1);
    world.updateSurfaces([floor]); advance(world, 1.5);
    expect(world.falls).toBe(1); expect(world.landings).toBeGreaterThan(0); expect(world.y).toBe(900);
  });
  it("does not mistake an occluded edge for a moved window", () => {
    const world = new CatWorld(); world.updateSurfaces([{ ...window, anchorX: 100 }, floor]);
    world.updateSurfaces([{ ...window, x: 400, width: 100, anchorX: 100 }, floor]);
    expect(world.support).toBeUndefined(); expect(world.x).toBe(300);
  });
  it("jumps ballistically onto a reachable neighboring window", () => {
    const world = new CatWorld(() => .9); const target: Surface = { owner: 2, x: 450, y: 300, width: 300, kind: "window" };
    world.updateSurfaces([window, target, floor]);
    expect(world.jumpTo(target, 520)).toBe(true); advance(world, 1.4);
    expect(world.support?.owner).toBe(2); expect(world.landings).toBe(1); expect(world.jumps).toBe(1);
  });
  it("rejects unreachable jumps and uses bounded timesteps", () => {
    const world = new CatWorld(); world.updateSurfaces([window, floor]);
    expect(world.jumpTo({ ...window, owner: 2, y: 20 })).toBe(false);
    world.updateSurfaces([floor]); world.step(30);
    expect(world.y).toBeLessThan(500); expect(Number.isFinite(world.vy)).toBe(true);
  });
  it("keeps approval visible despite lower-priority events and recovers after loss", () => {
    const world = new CatWorld(); world.updateSurfaces([window, floor]); world.react("approval"); world.react("type");
    expect(world.effect).toBe("approval"); advance(world, 41); expect(world.effect).toBe("idle");
    world.react("error"); world.react("observe"); expect(world.effect).toBe("error");
  });
  it("animates clicks as physical hops and wakes from sleep", () => {
    const world = new CatWorld(); world.updateSurfaces([window, floor]); world.state = "sleep"; world.react("type"); expect(world.state).toBe("wake");
    world.react("click"); advance(world, .3); expect(world.y).toBeLessThan(window.y); advance(world, .7); expect(world.landings).toBe(1);
  });
  it("accepts input immediately after an approval ends", () => {
    const world = new CatWorld(); world.updateSurfaces([window, floor]);
    world.react("approval"); world.react("approval", "end"); world.react("type");
    advance(world, .03);
    expect(world.effect).toBe("type"); expect(world.state).toBe("type");
  });
});
describe("cat artwork and animation", () => {
  it("has transparent silhouette, black fur and amber eyes", () => {
    const world = new CatWorld(); world.updateSurfaces([window, floor]);
    const frame = new CatAnimator().render(world, .03);
    expect(frame.pixels.includes(0)).toBe(true); expect(frame.pixels.includes(1)).toBe(true); expect(frame.pixels.includes(4)).toBe(true);
    expect(pixelRuns(frame, 2).get(4)?.length).toBeGreaterThan(0);
  });
  it("interpolates poses instead of swapping complete sprites", () => {
    const world = new CatWorld(); world.updateSurfaces([window, floor]); const animator = new CatAnimator();
    const awake = animator.render(world, .03).pixels; world.state = "sleep";
    const transition = animator.render(world, .016).pixels;
    for (let i = 0; i < 100; i++) animator.render(world, .03);
    const sleeping = animator.render(world, .03).pixels;
    expect(transition).not.toEqual(awake); expect(transition).not.toEqual(sleeping);
  });
});
describe("visual-only event parser", () => {
  const event = { version: 1, kind: "type", phase: "start", at: 1000, source: 12, seq: 1 };
  it("rejects stale, oversized, malformed and unknown events", () => {
    expect(parsePetEvent(Buffer.from(JSON.stringify(event)), 1000)).toMatchObject({ kind: "type" });
    expect(parsePetEvent(Buffer.from(JSON.stringify(event)), 100000)).toBeUndefined();
    expect(parsePetEvent(Buffer.from("null"))).toBeUndefined(); expect(parsePetEvent(Buffer.alloc(1100))).toBeUndefined();
    expect(parsePetEvent(Buffer.from(JSON.stringify({ ...event, kind: "approve_action" })), 1000)).toBeUndefined();
  });
  it("does not retain arbitrary payloads or decision data", () => {
    expect(parsePetEvent(Buffer.from(JSON.stringify({ ...event, confirmed: true, text: "secret" })), 1000)).toEqual(event);
  });
});
