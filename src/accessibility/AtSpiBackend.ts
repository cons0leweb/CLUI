import dbus, { type MessageBus } from "dbus-next";
import type { WindowInfo } from "../types/desktop.js";
import type { AccessibilityElement, AccessibilityTarget } from "../types/screenMap.js";
import type { AccessibilityAvailability, AccessibilityBackend, AccessibilityScanOptions } from "./AccessibilityBackend.js";

const ACCESSIBLE = "org.a11y.atspi.Accessible";
const COMPONENT = "org.a11y.atspi.Component";
const TEXT = "org.a11y.atspi.Text";
const PROPERTIES = "org.freedesktop.DBus.Properties";
const ROOT_BUS = "org.a11y.atspi.Registry";
const ROOT_PATH = "/org/a11y/atspi/accessible/root";
const SCREEN_COORDS = 0;

const STATE = {
  editable: 7,
  enabled: 8,
  focusable: 11,
  focused: 12,
  selectable: 22,
  selected: 23,
  showing: 25,
  visible: 30,
} as const;

interface ObjectRef { application: string; path: string }
interface NodeData {
  ref: ObjectRef;
  role: string;
  label: string;
  description: string;
  interfaces: string[];
  states: Set<number>;
  extents: { x: number; y: number; width: number; height: number } | null;
  children: ObjectRef[];
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds);
    timer.unref();
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function refs(value: unknown): ObjectRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string"
    ? [{ application: entry[0], path: entry[1] }]
    : []);
}

function stateSet(words: unknown): Set<number> {
  if (!Array.isArray(words)) return new Set();
  const result = new Set<number>();
  for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
    const word = Number(words[wordIndex]);
    for (let bit = 0; bit < 32; bit += 1) if ((word & (1 << bit)) !== 0) result.add(wordIndex * 32 + bit);
  }
  return result;
}

function overlapRatio(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = width * height;
  return intersection / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}

export class AtSpiBackend implements AccessibilityBackend {
  readonly name = "atspi";
  private bus: MessageBus | null = null;
  private availability: AccessibilityAvailability | null = null;

  async getAvailability(): Promise<AccessibilityAvailability> {
    if (this.availability) return this.availability;
    try {
      await this.getBus();
      this.availability = { available: true, backend: this.name, reason: null };
    } catch (error) {
      this.availability = { available: false, backend: this.name, reason: error instanceof Error ? error.message : String(error) };
    }
    return this.availability;
  }

  async getElementsForWindow(window: WindowInfo, options: AccessibilityScanOptions = {}): Promise<AccessibilityElement[]> {
    const availability = await this.getAvailability();
    if (!availability.available) throw new Error(availability.reason ?? "AT-SPI is unavailable");
    const deadline = performance.now() + (options.timeoutMs ?? 8_000);
    const maxNodes = options.maxNodes ?? 3_000;
    const bus = await this.getBus();
    await this.enableAccessibility().catch(() => undefined);
    const roots = refs((await this.call(bus, ROOT_BUS, ROOT_PATH, ACCESSIBLE, "GetChildren", deadline)).body[0]);
    const windowRoot = await this.findWindowRoot(bus, roots, window, deadline);
    if (!windowRoot) return [];

    const queue = [windowRoot];
    const elements: AccessibilityElement[] = [];
    let visited = 0;
    while (queue.length > 0 && visited < maxNodes) {
      if (performance.now() >= deadline) throw new Error("AT-SPI window traversal timed out");
      const batch = queue.splice(0, Math.min(20, maxNodes - visited));
      visited += batch.length;
      const nodes = await Promise.all(batch.map(async (ref) => {
        try { return await this.readNode(bus, ref, deadline); } catch { return null; }
      }));
      for (const node of nodes) {
        if (!node) continue;
        queue.push(...node.children);
        if (!node.extents) continue;
        elements.push({
          role: node.role,
          label: node.label || null,
          description: node.description || null,
          ...node.extents,
          visible: node.states.has(STATE.visible) && node.states.has(STATE.showing),
          enabled: node.states.has(STATE.enabled),
          focused: node.states.has(STATE.focused),
          focusable: node.states.has(STATE.focusable),
          clickable: node.interfaces.includes("org.a11y.atspi.Action"),
          editable: node.states.has(STATE.editable),
          selected: node.states.has(STATE.selected),
          target: { backend: this.name, application: node.ref.application, path: node.ref.path },
        });
      }
    }
    return elements;
  }

  async focusElement(target: AccessibilityTarget): Promise<boolean> {
    if (target.backend !== this.name) return false;
    const bus = await this.getBus();
    const reply = await withTimeout(this.callRaw(bus, target.application, target.path, COMPONENT, "GrabFocus"), 2_000, "AT-SPI focus");
    return Boolean(reply.body[0]);
  }

  async getElementGeometry(target: AccessibilityTarget): Promise<{ x: number; y: number; width: number; height: number } | null> {
    if (target.backend !== this.name) return null;
    const bus = await this.getBus();
    const deadline = performance.now() + 2_000;
    const reply = await this.callWithBody(bus, { application: target.application, path: target.path }, COMPONENT, "GetExtents", "u", [SCREEN_COORDS], deadline);
    const raw = Array.isArray(reply.body[0]) ? reply.body[0] : reply.body;
    if (raw.length < 4) return null;
    return { x: Number(raw[0]), y: Number(raw[1]), width: Number(raw[2]), height: Number(raw[3]) };
  }

  private async getBus(): Promise<MessageBus> {
    if (this.bus) return this.bus;
    if (!process.env.DBUS_SESSION_BUS_ADDRESS) throw new Error("DBUS_SESSION_BUS_ADDRESS is not set");
    const session = dbus.sessionBus();
    try {
      const reply = await withTimeout(this.callRaw(session, "org.a11y.Bus", "/org/a11y/bus", "org.a11y.Bus", "GetAddress"), 2_000, "AT-SPI bus discovery");
      const address = reply.body[0];
      if (typeof address !== "string" || !address) throw new Error("org.a11y.Bus returned no bus address");
      this.bus = dbus.sessionBus({ busAddress: address });
      return this.bus;
    } finally {
      session.disconnect();
    }
  }

  private async enableAccessibility(): Promise<void> {
    const session = dbus.sessionBus();
    try {
      const message = new dbus.Message({
        destination: "org.a11y.Bus",
        path: "/org/a11y/bus",
        interface: PROPERTIES,
        member: "Set",
        signature: "ssv",
        body: ["org.a11y.Status", "IsEnabled", new dbus.Variant("b", true)],
      });
      await withTimeout(session.call(message).then((reply) => {
        if (!reply) throw new Error("AT-SPI status update returned no reply");
        return reply;
      }), 2_000, "AT-SPI status enable");
    } finally {
      session.disconnect();
    }
  }

  private callRaw(bus: MessageBus, destination: string, path: string, interfaceName: string, member: string) {
    return bus.call(new dbus.Message({ destination, path, interface: interfaceName, member })).then((reply) => {
      if (!reply) throw new Error(`${interfaceName}.${member} returned no reply`);
      return reply;
    });
  }

  private call(bus: MessageBus, destination: string, path: string, interfaceName: string, member: string, deadline: number) {
    return withTimeout(this.callRaw(bus, destination, path, interfaceName, member), Math.max(1, deadline - performance.now()), `${interfaceName}.${member}`);
  }

  private async getProperty(bus: MessageBus, ref: ObjectRef, property: string, deadline: number): Promise<unknown> {
    const message = new dbus.Message({
      destination: ref.application,
      path: ref.path,
      interface: PROPERTIES,
      member: "Get",
      signature: "ss",
      body: [ACCESSIBLE, property],
    });
    const reply = await withTimeout(bus.call(message), Math.max(1, deadline - performance.now()), `AT-SPI property ${property}`);
    if (!reply) throw new Error(`AT-SPI property ${property} returned no reply`);
    return reply.body[0]?.value;
  }

  private async readNode(bus: MessageBus, ref: ObjectRef, deadline: number): Promise<NodeData> {
    const [properties, roleReply, stateReply, interfacesReply, childrenReply] = await Promise.all([
      this.getAllProperties(bus, ref, deadline).catch((): Record<string, { value: unknown }> => ({})),
      this.call(bus, ref.application, ref.path, ACCESSIBLE, "GetRoleName", deadline),
      this.call(bus, ref.application, ref.path, ACCESSIBLE, "GetState", deadline),
      this.call(bus, ref.application, ref.path, ACCESSIBLE, "GetInterfaces", deadline),
      this.call(bus, ref.application, ref.path, ACCESSIBLE, "GetChildren", deadline),
    ]);
    let label = properties.Name?.value;
    const description = properties.Description?.value;
    const interfaces = Array.isArray(interfacesReply.body[0]) ? interfacesReply.body[0].filter((value): value is string => typeof value === "string") : [];
    const states = stateSet(stateReply.body[0]);
    if ((!label || typeof label !== "string") && interfaces.includes(TEXT) && !states.has(STATE.editable)) {
      try {
        const textReply = await this.callWithBody(bus, ref, TEXT, "GetText", "ii", [0, -1], deadline);
        if (typeof textReply.body[0] === "string") label = textReply.body[0].slice(0, 2_000);
      } catch { /* a name is optional */ }
    }
    let extents: NodeData["extents"] = null;
    if (interfaces.includes(COMPONENT)) {
      try {
        const reply = await this.callWithBody(bus, ref, COMPONENT, "GetExtents", "u", [SCREEN_COORDS], deadline);
        const raw = Array.isArray(reply.body[0]) ? reply.body[0] : reply.body;
        if (raw.length >= 4) extents = { x: Number(raw[0]), y: Number(raw[1]), width: Number(raw[2]), height: Number(raw[3]) };
      } catch { /* nodes without usable screen geometry are still traversed */ }
    }
    return {
      ref,
      role: typeof roleReply.body[0] === "string" ? roleReply.body[0] : "unknown",
      label: typeof label === "string" ? label : "",
      description: typeof description === "string" ? description : "",
      interfaces,
      states,
      extents,
      children: refs(childrenReply.body[0]),
    };
  }

  private async getAllProperties(bus: MessageBus, ref: ObjectRef, deadline: number): Promise<Record<string, { value: unknown }>> {
    const reply = await this.callWithBody(bus, ref, PROPERTIES, "GetAll", "s", [ACCESSIBLE], deadline);
    const properties = reply.body[0];
    return properties && typeof properties === "object" ? properties as Record<string, { value: unknown }> : {};
  }

  private async callWithBody(bus: MessageBus, ref: ObjectRef, interfaceName: string, member: string, signature: string, body: unknown[], deadline: number) {
    const reply = await withTimeout(bus.call(new dbus.Message({ destination: ref.application, path: ref.path, interface: interfaceName, member, signature, body })), Math.max(1, deadline - performance.now()), `${interfaceName}.${member}`);
    if (!reply) throw new Error(`${interfaceName}.${member} returned no reply`);
    return reply;
  }

  private async findWindowRoot(bus: MessageBus, applications: ObjectRef[], window: WindowInfo, deadline: number): Promise<ObjectRef | null> {
    const title = window.title.toLocaleLowerCase();
    const className = (window.class ?? "").toLocaleLowerCase();
    let best: { ref: ObjectRef; score: number } | null = null;
    for (const application of applications) {
      if (performance.now() >= deadline) break;
      const applicationName = String(await this.getProperty(bus, application, "Name", deadline).catch(() => "")).toLocaleLowerCase();
      const applicationMatch = Boolean(applicationName) && (title.includes(applicationName) || (Boolean(className) && (className.includes(applicationName) || applicationName.includes(className))));
      let children: ObjectRef[];
      try { children = refs((await this.call(bus, application.application, application.path, ACCESSIBLE, "GetChildren", deadline)).body[0]); } catch { continue; }
      for (const child of children) {
        let node: NodeData;
        try { node = await this.readNode(bus, child, deadline); } catch { continue; }
        const name = node.label.toLocaleLowerCase();
        const titleScore = name && (title.includes(name) || name.includes(title)) ? 10 : 0;
        const applicationScore = applicationMatch ? 5 : 0;
        const geometryScore = node.extents ? overlapRatio(node.extents, window) * 3 : 0;
        const roleScore = /frame|window|dialog/.test(node.role.toLocaleLowerCase()) ? 1 : 0;
        const score = titleScore + applicationScore + geometryScore + roleScore;
        if (!best || score > best.score) best = { ref: child, score };
      }
    }
    return best && best.score >= 6 ? best.ref : null;
  }
}
