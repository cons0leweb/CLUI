import { describe, expect, it } from "vitest";
import { getPngDimensions } from "../src/system/png.js";

function minimalPngHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

describe("getPngDimensions", () => {
  it("reads dimensions from a valid PNG IHDR header", () => {
    expect(getPngDimensions(minimalPngHeader(1920, 1080))).toEqual({ width: 1920, height: 1080 });
  });

  it("rejects buffers that only contain PNG-like bytes", () => {
    const fake = Buffer.alloc(24);
    fake.write("PNG", 1, "ascii");
    fake.writeUInt32BE(1920, 16);
    fake.writeUInt32BE(1080, 20);
    expect(getPngDimensions(fake)).toBeNull();
  });
});
