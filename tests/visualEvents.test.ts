import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
const { socket, createSocket } = vi.hoisted(() => { const socket = { on: vi.fn(), unref: vi.fn(), send: vi.fn(), close: vi.fn() }; return { socket, createSocket: vi.fn(() => socket) }; });
vi.mock("node:dgram", () => ({ createSocket }));
import { VisualEventPublisher } from "../src/events/VisualEventPublisher.js";

describe("isolated visual publisher", () => {
  it("does not create sockets when disabled", () => {
    createSocket.mockClear(); new VisualEventPublisher(false).emit("click"); expect(createSocket).not.toHaveBeenCalled();
  });
  it("caps outstanding datagrams without waiting or retrying", () => {
    socket.send.mockClear(); const publisher = new VisualEventPublisher(true);
    for (let i = 0; i < 100; i++) publisher.emit("type");
    expect(socket.send).toHaveBeenCalledTimes(8);
    const payload = JSON.parse(socket.send.mock.calls[0]![0].toString());
    expect(Object.keys(payload).sort()).toEqual(["at", "kind", "phase", "seq", "source", "version"]);
    expect(socket.unref).toHaveBeenCalled(); publisher.close();
  });
  it("contains socket creation/send failures and disables the failed observer", () => {
    createSocket.mockImplementationOnce(() => { throw new Error("unavailable"); });
    const publisher = new VisualEventPublisher(true); expect(() => publisher.emit("approval")).not.toThrow();
    socket.send.mockClear(); publisher.emit("click"); expect(socket.send).not.toHaveBeenCalled();
    socket.send.mockImplementationOnce(() => { throw new Error("send failed"); });
    expect(() => new VisualEventPublisher(true).emit("error")).not.toThrow();
  });
});
