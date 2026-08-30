import { spawn } from "node:child_process";

export const ALLOWED_EXECUTABLES = [
  "xdotool",
  "xprop",
  "xwininfo",
  "xrandr",
  "maim",
  "import",
  "convert",
  "scrot",
] as const;

export type AllowedExecutable = (typeof ALLOWED_EXECUTABLES)[number];

export interface CommandOptions {
  timeoutMs?: number;
  input?: Buffer;
  maxOutputBytes?: number;
}

export interface CommandResult {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export class CommandError extends Error {
  constructor(
    message: string,
    readonly executable: AllowedExecutable,
    readonly args: readonly string[],
    readonly kind: "not_found" | "timeout" | "exit" | "output_limit" | "spawn",
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "CommandError";
  }
}

function isAllowed(value: string): value is AllowedExecutable {
  return (ALLOWED_EXECUTABLES as readonly string[]).includes(value);
}

export async function runCommand(
  executable: AllowedExecutable,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  if (!isAllowed(executable)) throw new Error(`Executable is not allowlisted: ${String(executable)}`);
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxOutputBytes = options.maxOutputBytes ?? 64 * 1024 * 1024;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new RangeError("timeoutMs must be a positive integer");
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes <= 0) throw new RangeError("maxOutputBytes must be a positive integer");
  const started = performance.now();

  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(executable, [...args], {
      shell: false,
      stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"],
      env: process.env,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    const fail = (error: CommandError): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      fail(new CommandError(`${executable} timed out after ${timeoutMs}ms`, executable, args, "timeout", null, Buffer.concat(stderr).toString("utf8")));
    }, timeoutMs);
    timer.unref();

    const stdoutStream = child.stdout;
    const stderrStream = child.stderr;
    if (!stdoutStream || !stderrStream) {
      child.kill("SIGKILL");
      fail(new CommandError(`Failed to capture ${executable} output`, executable, args, "spawn", null, ""));
      return;
    }

    stdoutStream.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill("SIGKILL");
        fail(new CommandError(`${executable} exceeded output limit`, executable, args, "output_limit", null, Buffer.concat(stderr).toString("utf8")));
        return;
      }
      stdout.push(chunk);
    });
    stderrStream.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill("SIGKILL");
        fail(new CommandError(`${executable} exceeded output limit`, executable, args, "output_limit", null, Buffer.concat(stderr).toString("utf8")));
        return;
      }
      stderr.push(chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      const kind = error.code === "ENOENT" ? "not_found" : "spawn";
      fail(new CommandError(
        kind === "not_found" ? `Required executable '${executable}' is not installed or not on PATH` : `Failed to start ${executable}: ${error.message}`,
        executable,
        args,
        kind,
        null,
        Buffer.concat(stderr).toString("utf8"),
      ));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stderrText = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        reject(new CommandError(`${executable} exited with code ${code}${stderrText ? `: ${stderrText}` : ""}`, executable, args, "exit", code, stderrText));
        return;
      }
      resolve({ stdout: Buffer.concat(stdout), stderr: stderrText, exitCode: 0, durationMs: performance.now() - started });
    });

    if (options.input) child.stdin?.end(options.input);
  });
}

export async function runText(executable: AllowedExecutable, args: readonly string[], timeoutMs = 5_000): Promise<string> {
  return (await runCommand(executable, args, { timeoutMs, maxOutputBytes: 4 * 1024 * 1024 })).stdout.toString("utf8");
}
