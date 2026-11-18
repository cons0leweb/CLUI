import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import type { Readable, Writable } from "node:stream";

export async function serveUntilClosed(
  factory: Parameters<typeof serveStdio>[0],
  stdin: Readable = process.stdin,
  stdout: Writable = process.stdout,
): Promise<void> {
  const transport = new StdioServerTransport(stdin, stdout);
  let disconnected!: () => void;
  const closed = new Promise<void>((resolve) => { disconnected = resolve; });
  // serveStdio returns a handle immediately, not a promise for the connection lifetime.
  const handle = serveStdio(factory, { transport });
  const onclose = transport.onclose;
  transport.onclose = () => { onclose?.(); disconnected(); };
  const end = (): void => { void handle.close(); };
  stdin.once("end", end);
  stdin.once("close", end);
  if (stdin.readableEnded || stdin.destroyed) end();
  try {
    await closed;
  } finally {
    stdin.off("end", end);
    stdin.off("close", end);
    await handle.close();
  }
}
