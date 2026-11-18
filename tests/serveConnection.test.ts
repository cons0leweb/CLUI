import { PassThrough } from "node:stream";
import { expect, it } from "vitest";
import { serveUntilClosed } from "../src/system/serveConnection.js";
import { createServer } from "../src/server.js";
import { ScreenMapService } from "../src/screenmap/ScreenMapService.js";
import { FakeDesktop, FakeAccessibility } from "./screenMapFixtures.js";
import { CursorIndicator } from "../src/indicator/CursorIndicator.js";

it("keeps the indicator alive across MCP calls and closes after stdin EOF", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const backend = new FakeDesktop();
  const indicator = new CursorIndicator({ available: true, send() {}, async close() {} });
  const lifetime = serveUntilClosed(() => createServer(backend, new ScreenMapService(backend, new FakeAccessibility()), indicator), input, output).finally(() => indicator.close());
  let pending = "";
  const responses = new Map<number, (value: any) => void>();
  output.on("data", (chunk) => {
    pending += chunk.toString();
    while (pending.includes("\n")) {
      const index = pending.indexOf("\n");
      const message = JSON.parse(pending.slice(0, index));
      pending = pending.slice(index + 1);
      responses.get(message.id)?.(message);
    }
  });
  const request = (id: number, method: string, params: unknown) => new Promise<any>((resolve) => {
    responses.set(id, resolve);
    input.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  try {
    const init = await request(1, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.error).toBeUndefined();
    input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    for (const id of [2, 3]) {
      const response = await request(id, "tools/call", { name: "desktop_control_session", arguments: { action: "status" } });
      expect(JSON.parse(response.result.content[0].text).enabled).toBe(true);
    }
  } finally {
    input.end();
    await lifetime;
  }
  expect(indicator.status().enabled).toBe(false);
});
