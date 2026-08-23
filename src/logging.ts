export type LogLevel = "info" | "error";

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  process.stderr.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields })}\n`);
}

export function summarizeToolInput(name: string, input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  const safe = { ...(input as Record<string, unknown>) };
  if (name === "desktop_type_text" && typeof safe.text === "string") safe.text = { length: safe.text.length };
  if (name === "desktop_act" && Array.isArray(safe.actions)) {
    safe.actions = safe.actions.map((action) => {
      if (!action || typeof action !== "object") return action;
      const copy = { ...(action as Record<string, unknown>) };
      if (typeof copy.text === "string") copy.text = { length: copy.text.length };
      return copy;
    });
  }
  return safe;
}
