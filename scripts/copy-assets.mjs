import { copyFile, mkdir } from "node:fs/promises";
const output = new URL("../dist/indicator/", import.meta.url);
await mkdir(output, { recursive: true });
await copyFile(new URL("../src/indicator/cursor_overlay.py", import.meta.url), new URL("cursor_overlay.py", output));
