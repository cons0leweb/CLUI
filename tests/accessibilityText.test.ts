import dbus from "dbus-next";
import { describe, expect, it, vi } from "vitest";
import { AtSpiBackend } from "../src/accessibility/AtSpiBackend.js";
import { testWindow } from "./screenMapFixtures.js";

const ref = { backend: "atspi", application: ":1.1", path: "/text" };
const TEXT = "org.a11y.atspi.Text";

function fixture(password = false) {
  const content = "Привет 🌍\n".repeat(500);
  const call = vi.fn(async (message: dbus.Message) => {
    const { member, path, body } = message;
    if (member === "GetRoleName") return { body: [path === "/window" ? "frame" : password ? "password text" : "text"] };
    if (member === "Get" && body[1] === "CharacterCount") return { body: [new dbus.Variant("i", Array.from(content).length)] };
    if (member === "GetText") return { body: [Array.from(content).slice(body[0], body[1]).join("")] };
    if (member === "Get" && body[1] === "Name") return { body: [new dbus.Variant("s", "Test")] };
    if (member === "GetChildren") return { body: [path === "/org/a11y/atspi/accessible/root" ? [[":1.1", "/app"]] : path === "/app" ? [[":1.1", "/window"]] : path === "/window" ? [[":1.1", "/text"]] : []] };
    if (member === "GetAll") return { body: [{ Name: new dbus.Variant("s", path === "/window" ? "Test window" : "") }] };
    if (member === "GetState") return { body: [[0, 0]] };
    if (member === "GetInterfaces") return { body: [path === "/text" ? [TEXT] : []] };
    throw new Error(`Unexpected ${member}`);
  });
  const backend = new AtSpiBackend();
  Object.assign(backend, { bus: { call } });
  return { backend, call, content };
}

describe("AT-SPI text reads", () => {
  it("clamps ranges to character count and preserves Unicode character offsets", async () => {
    const { backend, call, content } = fixture();
    const length = Array.from(content).length;
    expect(await backend.readText(ref, length - 3, length + 100)).toBe(Array.from(content).slice(-3).join(""));
    expect(await backend.readText(ref, length, length + 100)).toBe("");
    expect(call.mock.calls.filter(([m]) => m.member === "GetText")).toHaveLength(1);
  });

  it("reads nodes without visible geometry and reports truncation", async () => {
    const { backend } = fixture();
    const result = await backend.readWindowText(testWindow, 50);
    expect(result.blocks[0]?.text).toHaveLength(50);
    expect(result.partial).toBe(true);
  });

  it("rejects password text before requesting content", async () => {
    const { backend, call } = fixture(true);
    await expect(backend.readText(ref, 0, 100)).rejects.toThrow("Password");
    expect(call.mock.calls.some(([m]) => m.member === "GetText")).toBe(false);
    expect((await backend.readWindowText(testWindow, 100)).blocks).toEqual([]);
    expect(call.mock.calls.some(([m]) => m.member === "GetText")).toBe(false);
  });
});
