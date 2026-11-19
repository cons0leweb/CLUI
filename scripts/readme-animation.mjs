import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CatAnimator, PALETTE } from '../dist/pet/CatAnimator.js';
import { CatWorld, seededRandom } from '../dist/pet/World.js';

const states = ['observe', 'type', 'approval', 'confused', 'sleep'];
const cats = states.map((state, index) => {
  const world = new CatWorld(seededRandom(index));
  world.updateSurfaces([{ owner: 1, x: 0, y: 400, width: 500, kind: 'window' }]);
  world.state = state;
  world.effect = state === 'confused' ? 'error' : state === 'sleep' ? 'idle' : state;
  const animator = new CatAnimator();
  for (let i = 0; i < 50; i++) animator.render(world, 1 / 12);
  return { world, animator };
});
const directory = await mkdtemp(join(tmpdir(), 'clui-readme-'));
const output = process.argv[2] ?? 'docs/assets/clui-pet.gif';
const width = 640, height = 128, scale = 2;
try {
  const frames = [];
  for (let index = 0; index < 72; index++) {
    const rgb = Buffer.alloc(width * height * 3);
    for (let p = 0; p < rgb.length; p += 3) {
      rgb[p] = 54; rgb[p + 1] = 64; rgb[p + 2] = 82;
    }
    for (const [column, { world, animator }] of cats.entries()) {
      world.time = index / 12;
      const frame = animator.render(world, 1 / 12, { x: 250 + Math.sin(world.time) * 180, y: 300 });
      for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
        const pixel = frame.pixels[y * frame.width + x];
        if (!pixel) continue;
        const color = PALETTE[pixel];
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
          const offset = ((y * scale + sy + 4) * width + column * 128 + x * scale + sx) * 3;
          rgb[offset] = color >> 16; rgb[offset + 1] = color >> 8; rgb[offset + 2] = color;
        }
      }
    }
    const path = join(directory, `${String(index).padStart(3, '0')}.ppm`);
    await writeFile(path, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), rgb]));
    frames.push(path);
  }
  await mkdir('docs/assets', { recursive: true });
  await promisify(execFile)('magick', ['-delay', '8', '-loop', '0', ...frames, '-layers', 'Optimize', output], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  console.log(`Wrote ${output}`);
} finally { await rm(directory, { recursive: true, force: true }); }
