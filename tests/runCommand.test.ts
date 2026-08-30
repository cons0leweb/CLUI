import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { CommandError, runCommand } from "../src/system/runCommand.js";

describe.sequential("runCommand", () => {
  const originalPath = process.env.PATH;
  const directories: string[] = [];

  afterEach(async () => {
    process.env.PATH = originalPath;
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  async function fixture(source: string): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), "clui-runner-test-"));
    directories.push(directory);
    const path = join(directory, "xprop");
    await writeFile(path, source);
    await chmod(path, 0o755);
    process.env.PATH = directory;
  }

  it("passes argument arrays literally and captures stdout", async () => {
    await fixture("#!/bin/sh\nprintf '%s' \"$1\"\n");
    const result = await runCommand("xprop", ["$(touch /tmp/must-not-exist); hello world"]);
    expect(result.stdout.toString()).toBe("$(touch /tmp/must-not-exist); hello world");
  });

  it("kills a command that exceeds its timeout", async () => {
    await fixture("#!/bin/sh\nwhile :; do :; done\n");
    await expect(runCommand("xprop", [], { timeoutMs: 30 })).rejects.toMatchObject({ kind: "timeout" } satisfies Partial<CommandError>);
  });

  it("turns ENOENT into a typed, actionable error", async () => {
    process.env.PATH = "/path/that/does/not/exist";
    await expect(runCommand("xprop", [])).rejects.toMatchObject({ kind: "not_found" } satisfies Partial<CommandError>);
  });

  it("rejects invalid resource limits before spawning", async () => {
    await expect(runCommand("xprop", [], { timeoutMs: 0 })).rejects.toThrow(/timeoutMs/);
    await expect(runCommand("xprop", [], { maxOutputBytes: 0 })).rejects.toThrow(/maxOutputBytes/);
  });
});
