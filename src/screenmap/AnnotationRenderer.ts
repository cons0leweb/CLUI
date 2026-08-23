import { runCommand } from "../system/runCommand.js";
import type { Screenshot, WindowInfo } from "../types/desktop.js";
import type { ScreenElement } from "../types/screenMap.js";

export interface AnnotationCommandRunner {
  (args: readonly string[], input: Buffer): Promise<Buffer>;
}

export interface AnnotationBox { id: number; x: number; y: number; width: number; height: number }

export function mapAnnotationBoxes(elements: readonly ScreenElement[], window: WindowInfo, screenshot: Screenshot): AnnotationBox[] {
  const imageWidth = screenshot.width ?? window.width;
  const imageHeight = screenshot.height ?? window.height;
  const scaleX = imageWidth / Math.max(1, window.width);
  const scaleY = imageHeight / Math.max(1, window.height);
  return elements.flatMap((element) => {
    const left = Math.max(0, Math.round((element.x - window.x) * scaleX));
    const top = Math.max(0, Math.round((element.y - window.y) * scaleY));
    const right = Math.min(imageWidth - 1, Math.round((element.x + element.width - window.x) * scaleX));
    const bottom = Math.min(imageHeight - 1, Math.round((element.y + element.height - window.y) * scaleY));
    if (right <= left || bottom <= top) return [];
    return [{ id: element.id, x: left, y: top, width: right - left, height: bottom - top }];
  });
}

export function annotationArguments(boxes: readonly AnnotationBox[]): string[] {
  const args = ["png:-"];
  for (const box of boxes) {
    const label = `[${box.id}]`;
    const labelWidth = Math.max(24, 8 + label.length * 8);
    const labelX = box.x;
    const labelY = box.y >= 18 ? box.y - 18 : box.y;
    args.push(
      "-stroke", "black", "-strokewidth", "1", "-fill", "none", "-draw", `rectangle ${box.x},${box.y} ${box.x + box.width},${box.y + box.height}`,
      "-stroke", "black", "-fill", "white", "-draw", `rectangle ${labelX},${labelY} ${labelX + labelWidth},${labelY + 17}`,
      "-stroke", "none", "-fill", "black", "-pointsize", "12", "-annotate", `+${labelX + 3}+${labelY + 13}`, label,
    );
  }
  args.push("png:-");
  return args;
}

const defaultRunner: AnnotationCommandRunner = async (args, input) => (await runCommand("convert", args, { input, timeoutMs: 15_000 })).stdout;

export class AnnotationRenderer {
  constructor(private readonly runner: AnnotationCommandRunner = defaultRunner) {}

  async render(screenshot: Screenshot, window: WindowInfo, elements: readonly ScreenElement[]): Promise<Screenshot> {
    const boxes = mapAnnotationBoxes(elements, window, screenshot);
    if (boxes.length === 0) return screenshot;
    return { ...screenshot, png: await this.runner(annotationArguments(boxes), screenshot.png), backend: `${screenshot.backend}+imagemagick` };
  }
}
