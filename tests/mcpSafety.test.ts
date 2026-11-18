import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serveUntilClosed } from "../src/system/serveConnection.js";
import { createServer } from "../src/server.js";
import { ScreenMapService } from "../src/screenmap/ScreenMapService.js";
import { AnnotationRenderer } from "../src/screenmap/AnnotationRenderer.js";
import { FakeDesktop, FakeAccessibility } from "./screenMapFixtures.js";
import { dispatchInput } from "../src/actions/dispatchScope.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map((close) => close())); });

async function harness(approval?: () => Promise<{ action: string; content?: { approve: boolean } }>) {
  const input = new PassThrough(), output = new PassThrough();
  const desktop = new FakeDesktop(), accessibility = new FakeAccessibility();
  const screenMap = new ScreenMapService(desktop, accessibility, undefined, new AnnotationRenderer(async (_args, bytes) => bytes));
  const lifetime = serveUntilClosed(() => createServer(desktop, screenMap), input, output);
  closers.push(async () => { input.end(); await lifetime; });
  let pending = "", id = 0, approvals = 0;
  const replies = new Map<number, (value: any) => void>();
  output.on("data", (chunk) => {
    pending += chunk.toString();
    while (pending.includes("\n")) {
      const index = pending.indexOf("\n"), message = JSON.parse(pending.slice(0, index));
      pending = pending.slice(index + 1);
      if (message.method === "elicitation/create") {
        approvals += 1;
        void approval?.().then((result) => input.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n"));
      } else replies.get(message.id)?.(message);
    }
  });
  const request = (method: string, params: unknown) => new Promise<any>((resolve) => {
    const current = ++id;
    replies.set(current, resolve);
    input.write(JSON.stringify({ jsonrpc: "2.0", id: current, method, params }) + "\n");
  });
  await request("initialize", { protocolVersion: "2025-11-25", capabilities: approval ? { elicitation: { form: {} } } : {}, clientInfo: { name: "safety-test", version: "1" } });
  input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const rawCall = (name: string, args: unknown) => request("tools/call", { name, arguments: args });
  const call = async (name: string, args: unknown = {}) => {
    const response = await rawCall(name, args);
    if (response.error || response.result?.isError) throw new Error(JSON.stringify(response));
    return JSON.parse(response.result.content[0].text);
  };
  const caps = await call("desktop_get_capabilities");
  const identity = (request_id: string) => ({ session_id: caps.action_session_id, request_id });
  return { desktop, accessibility, screenMap, call, rawCall, identity, approvalCount: () => approvals };
}

describe("MCP safety contract", () => {
  it("uses the same focus rules for a standalone key and a batch step", async () => {
    const f = await harness();
    const send = vi.fn(async () => {});
    vi.spyOn(f.desktop, "keyPress").mockImplementation(() => dispatchInput(send));
    const expected_window_id = "0x999";
    expect(await f.call("desktop_key_press", { ...f.identity("single"), expected_window_id, key: "a" })).toMatchObject({ status: "precondition_failed", reason: "active_window_mismatch" });
    expect(await f.call("desktop_act", { ...f.identity("batch"), actions: [{ type: "key", expected_window_id, key: "a" }] })).toMatchObject({ status: "precondition_failed", failed_step: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("does not send input for an agent asserted confirmation or missing identity", async () => {
    const f = await harness();
    const send = vi.spyOn(f.desktop, "keyPress");
    const response = await f.rawCall("desktop_key_press", { ...f.identity("fake-confirmation"), expected_window_id: "0x123", key: "F4", confirmed: true });
    expect(response.error || response.result?.isError).toBeTruthy();
    const noIdentity = await f.rawCall("desktop_type_text", { text: "do not type", expected_window_id: "0x123" });
    expect(noIdentity.error || noIdentity.result?.isError).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });

  it("blocks unsupported approval channels with a structured result", async () => {
    const f = await harness();
    const send = vi.spyOn(f.desktop, "keyPress");
    expect(await f.call("desktop_key_press", { ...f.identity("blocked"), key: "F4", expected_window_id: "0x123" })).toMatchObject({ status: "approval_unavailable" });
    expect(send).not.toHaveBeenCalled();
  });

  it("accepts a real client elicitation response once and replays the result", async () => {
    const f = await harness(async () => ({ action: "accept", content: { approve: true } }));
    const send = vi.fn(async () => {});
    vi.spyOn(f.desktop, "keyPress").mockImplementation(() => dispatchInput(send));
    const args = { ...f.identity("approved"), key: "F4", expected_window_id: "0x123" };
    const first = await f.call("desktop_key_press", args);
    expect(first.status).toBe("dispatched");
    expect(await f.call("desktop_key_press", args)).toEqual(first);
    expect(send).toHaveBeenCalledOnce();
    expect(f.approvalCount()).toBe(1);
  });

  it("checks focus again after the client has approved", async () => {
    let changeFocus = () => {};
    const f = await harness(async () => { changeFocus(); return { action: "accept", content: { approve: true } }; });
    changeFocus = () => { f.desktop.window = { ...f.desktop.window, id: "0x456" }; };
    const send = vi.spyOn(f.desktop, "keyPress");
    expect(await f.call("desktop_key_press", { ...f.identity("changed"), key: "F4", expected_window_id: "0x123" })).toMatchObject({ status: "precondition_failed", reason: "active_window_mismatch" });
    expect(send).not.toHaveBeenCalled();
  });

  it("invokes semantic actions without clicking and never falls back after uncertainty", async () => {
    const f = await harness(async () => ({ action: "accept", content: { approve: true } }));
    const snapshot = await f.call("desktop_observe_marked", {});
    const invoke = vi.spyOn(f.accessibility, "performAction").mockImplementation(() => dispatchInput(async () => { throw new Error("lost reply"); }));
    const click = vi.spyOn(f.desktop, "clickMouse");
    expect(await f.call("desktop_get_element_actions", { snapshot_id: snapshot.snapshot_id, element_id: 1 })).toMatchObject({ actions: [{ name: "click" }] });
    const args = { ...f.identity("semantic"), snapshot_id: snapshot.snapshot_id, element_id: 1, action_name: "click" };
    const result = await f.call("desktop_perform_element_action", args);
    expect(result.status).toBe("outcome_unknown");
    expect(await f.call("desktop_perform_element_action", args)).toEqual(result);
    expect(invoke).toHaveBeenCalledOnce();
    expect(click).not.toHaveBeenCalled();
    expect(await f.call("desktop_type_text", { ...f.identity("blocked-until-observation"), expected_window_id: "0x123", text: "test" })).toMatchObject({ reason: "fresh_observation_required" });
    await f.call("desktop_observe", {});
    expect((await f.call("desktop_type_text", { ...f.identity("after-observation"), expected_window_id: "0x123", text: "test" })).status).toBe("dispatched");
  });
});
