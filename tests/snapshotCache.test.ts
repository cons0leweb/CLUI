import { describe, expect, it } from "vitest";
import { SnapshotCache, SnapshotExpiredError, SnapshotNotFoundError } from "../src/screenmap/SnapshotCache.js";
import type { ScreenMapSnapshot } from "../src/types/screenMap.js";
import { testWindow } from "./screenMapFixtures.js";

function snapshot(id: string, expiresAt: number): ScreenMapSnapshot {
  return { snapshotId: id, createdAt: 0, expiresAt, window: testWindow, screenshot: { png: Buffer.alloc(0), source: "window", backend: "fake" }, elements: [], targets: new Map(), screenMapAvailable: false, annotatedScreenshotAvailable: false, reason: "empty" };
}

describe("SnapshotCache", () => {
  it("rejects invalid cache configuration", () => {
    expect(() => new SnapshotCache(0)).toThrow(/maxEntries/);
    expect(() => new SnapshotCache(1, 0)).toThrow(/ttlMs/);
  });

  it("expires snapshots", () => {
    let now = 10;
    const cache = new SnapshotCache(2, 50, () => now);
    cache.put(snapshot("a", 20));
    now = 20;
    expect(() => cache.get("a")).toThrow(SnapshotExpiredError);
  });

  it("evicts the oldest snapshot at the bound", () => {
    const cache = new SnapshotCache(1, 50, () => 0);
    cache.put(snapshot("a", 100));
    cache.put(snapshot("b", 100));
    expect(() => cache.get("a")).toThrow(SnapshotNotFoundError);
    expect(cache.get("b").snapshotId).toBe("b");
  });
});
