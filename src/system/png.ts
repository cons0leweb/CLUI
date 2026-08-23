export function getPngDimensions(png: Buffer): { width: number; height: number } | null {
  if (png.length < 24 || png.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
