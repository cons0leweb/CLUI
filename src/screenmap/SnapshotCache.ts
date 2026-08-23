import type { ScreenMapSnapshot } from "../types/screenMap.js";

export class SnapshotNotFoundError extends Error {
  constructor(snapshotId: string) {
    super(`ScreenMap snapshot '${snapshotId}' was not found or has been evicted`);
    this.name = "SnapshotNotFoundError";
  }
}

export class SnapshotExpiredError extends Error {
  constructor(snapshotId: string) {
    super(`ScreenMap snapshot '${snapshotId}' has expired; call desktop_observe_marked again`);
    this.name = "SnapshotExpiredError";
  }
}

export class SnapshotCache {
  private readonly snapshots = new Map<string, ScreenMapSnapshot>();

  constructor(readonly maxEntries = 15, readonly ttlMs = 60_000, private readonly now = () => Date.now()) {}

  put(snapshot: ScreenMapSnapshot): void {
    this.prune();
    this.snapshots.set(snapshot.snapshotId, snapshot);
    while (this.snapshots.size > this.maxEntries) {
      const oldest = this.snapshots.keys().next().value as string | undefined;
      if (!oldest) break;
      this.snapshots.delete(oldest);
    }
  }

  get(snapshotId: string): ScreenMapSnapshot {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) throw new SnapshotNotFoundError(snapshotId);
    if (snapshot.expiresAt <= this.now()) {
      this.snapshots.delete(snapshotId);
      throw new SnapshotExpiredError(snapshotId);
    }
    return snapshot;
  }

  private prune(): void {
    const now = this.now();
    for (const [id, snapshot] of this.snapshots) if (snapshot.expiresAt <= now) this.snapshots.delete(id);
  }
}
