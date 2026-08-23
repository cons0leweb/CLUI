import * as z from "zod/v4";

export const windowIdSchema = z.string().regex(/^(?:0x[0-9a-f]+|[0-9]+)$/i, "Expected a decimal or hexadecimal X11 window id");
export const mouseButtonSchema = z.enum(["left", "middle", "right"]);
export const modifierSchema = z.enum(["Ctrl", "Alt", "Shift", "Super"]);
export const coordinateSchema = z.number().finite();
export const dimensionSchema = z.number().int().positive().max(32_768);
export const durationSchema = z.number().int().min(0).max(10_000);

export const regionSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: dimensionSchema,
  height: dimensionSchema,
});

export const windowPointSchema = z.object({
  window_id: windowIdSchema,
  x: coordinateSchema,
  y: coordinateSchema,
  normalized: z.boolean().default(false),
});

export const screenshotSchema = z.object({
  mode: z.enum(["screen", "active_window", "window", "region"]).default("screen"),
  window_id: windowIdSchema.optional(),
  region: regionSchema.optional(),
  max_width: dimensionSchema.optional(),
  max_height: dimensionSchema.optional(),
}).superRefine((value, context) => {
  if (value.mode === "window" && !value.window_id) context.addIssue({ code: "custom", path: ["window_id"], message: "window_id is required when mode=window" });
  if (value.mode === "region" && !value.region) context.addIssue({ code: "custom", path: ["region"], message: "region is required when mode=region" });
});

const focusActionSchema = z.object({ type: z.literal("focus"), window_id: windowIdSchema.optional(), title: z.string().min(1).optional(), timeout_ms: z.number().int().min(100).max(10_000).optional() })
  .refine((value) => Boolean(value.window_id) !== Boolean(value.title), "Focus requires exactly one of window_id or title");
const moveActionSchema = z.object({ type: z.literal("move"), x: coordinateSchema, y: coordinateSchema, duration_ms: durationSchema.optional(), window_id: windowIdSchema.optional(), normalized: z.boolean().default(false) });
const clickActionSchema = z.object({ type: z.literal("click"), x: coordinateSchema.optional(), y: coordinateSchema.optional(), button: mouseButtonSchema.default("left"), count: z.number().int().min(1).max(10).default(1), interval_ms: z.number().int().min(0).max(2_000).default(100), window_id: windowIdSchema.optional(), normalized: z.boolean().default(false) })
  .refine((value) => (value.x === undefined) === (value.y === undefined), "Click x and y must be provided together");
const keyActionSchema = z.object({ type: z.literal("key"), key: z.string().min(1).max(64), modifiers: z.array(modifierSchema).max(4).default([]) });
const typeActionSchema = z.object({ type: z.literal("type"), text: z.string().max(100_000), interval_ms: z.number().int().min(0).max(1_000).default(12) });
const waitActionSchema = z.object({ type: z.literal("wait"), milliseconds: z.number().int().min(0).max(10_000) });
const scrollActionSchema = z.object({ type: z.literal("scroll"), delta_x: z.number().int().min(-100).max(100).default(0), delta_y: z.number().int().min(-100).max(100).default(0) });

export const actSchema = z.object({
  actions: z.array(z.discriminatedUnion("type", [focusActionSchema, moveActionSchema, clickActionSchema, keyActionSchema, typeActionSchema, waitActionSchema, scrollActionSchema])).min(1).max(20),
});
