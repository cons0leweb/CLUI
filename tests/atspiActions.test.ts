import { describe, expect, it, vi } from "vitest";
import type dbus from "dbus-next";
import { AtSpiBackend } from "../src/accessibility/AtSpiBackend.js";
import { withDispatchScope } from "../src/actions/dispatchScope.js";

const target = { backend: "atspi", application: ":1.1", path: "/button" };
function fixture() {
  let actions = [["click", "Click", ""], ["delete", "Delete", ""]];
  const call = vi.fn(async (message: dbus.Message) => {
    if (message.member === "GetActions") return { body: [actions] };
    if (message.member === "DoAction") return { body: [true] };
    throw new Error("Unexpected method");
  });
  const backend = new AtSpiBackend();
  Object.assign(backend, { bus: { call } });
  return { backend, call, setActions(value: string[][]) { actions = value; } };
}

describe("AT-SPI dispatch boundary", () => {
  it("resolves the named action after final validation even if action indexes changed", async () => {
    const f = fixture();
    const state = { attempted: false, validate: async () => { f.setActions([["delete", "Delete", ""], ["click", "Click", ""]]); } };
    await withDispatchScope(state, () => f.backend.performAction(target, "click"));
    expect(state.attempted).toBe(true);
    expect(f.call.mock.calls.find(([message]) => message.member === "DoAction")?.[0].body).toEqual([1]);
  });

  it("does not mark or send a mutation if action discovery fails", async () => {
    const f = fixture();
    f.call.mockRejectedValue(new Error("discovery unavailable"));
    const state = { attempted: false, validate: async () => {} };
    await expect(withDispatchScope(state, () => f.backend.performAction(target, "click"))).rejects.toMatchObject({ status: "precondition_unknown" });
    expect(state.attempted).toBe(false);
    expect(f.call.mock.calls.some(([message]) => message.member === "DoAction")).toBe(false);
  });

  it("does not retry when the reply to DoAction is lost", async () => {
    const f = fixture();
    const previous = f.call.getMockImplementation()!;
    f.call.mockImplementation(async (message) => {
      if (message.member === "DoAction") throw new Error("reply lost");
      return previous(message);
    });
    const state = { attempted: false, validate: async () => {} };
    await expect(withDispatchScope(state, () => f.backend.performAction(target, "click"))).rejects.toThrow("reply lost");
    expect(state.attempted).toBe(true);
    expect(f.call.mock.calls.filter(([message]) => message.member === "DoAction")).toHaveLength(1);
  });
});
