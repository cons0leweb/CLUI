// Isolated X11 fixture windows; no keyboard input, MCP actions, or approval decisions.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { X11Desktop } from '../dist/pet/X11Desktop.js';
import { control, runtimeDirectory } from '../dist/pet/runtime.js';
import { VisualEventPublisher } from '../dist/events/VisualEventPublisher.js';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cli = fileURLToPath(new URL('../dist/pet/cli.js', import.meta.url));
const directory = await runtimeDirectory();
try { const running = await control(directory, 'status'); throw Error(`Stop the existing pet first (PID ${running.pid})`); }
catch (e) { if (!['ENOENT', 'ECONNREFUSED'].includes(e.code)) throw e; }
const desktop = await X11Desktop.connect(2);
const before = await desktop.query('GetInputFocus');
const ids = [desktop.client.AllocID(), desktop.client.AllocID()];
let pet;
const publisher = new VisualEventPublisher(true);
const report = {};
const assert = (condition, message) => { if (!condition) throw Error(message); };
async function waitFor(predicate, seconds = 4) {
  let last;
  for (let i = 0; i < seconds * 10; i++) { last = await control(directory, 'status'); if (predicate(last)) return last; await sleep(100); }
  throw Error(`Pet state did not reach the expected condition: ${JSON.stringify(last)}`);
}
try {
  for (const [index, id] of ids.entries()) {
    desktop.send('CreateWindow', id, desktop.root, index ? 350 : 0, index ? 220 : 92, index ? 500 : 1280, index ? 200 : 900, 0, 0, 1, 0, { backgroundPixel: index ? 0x253c55 : 0x294637, eventMask: 32768 });
    desktop.send('ChangeProperty', 0, id, 39, 31, 8, Buffer.from(`CLUI Pet test platform ${index + 1}`));
    desktop.send('MapWindow', id);
  }
  await sleep(400);
  for (const [index, id] of ids.entries()) desktop.send('ConfigureWindow', id, { x: index ? 350 : 0, y: index ? 220 : 92, width: index ? 500 : 1280, height: index ? 220 : 400 });
  await sleep(400);
  const focus = await desktop.query('GetInputFocus');
  pet = spawn(process.execPath, [cli, 'run', '--duration', '70', '--seed', '18'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; pet.stderr.on('data', chunk => { errors += chunk; });
  let initial;
  for (let i = 0; i < 40; i++) { await sleep(100); try { initial = await control(directory, 'status'); break; } catch {} }
  assert(initial, `Pet failed to start: ${errors}`);
  initial = await waitFor(s => s.ready && s.support);
  assert(ids.includes(initial.support?.owner), `Pet did not find fixture windows: ${JSON.stringify(initial.support)}`);
  report.focus_unchanged_on_start = (await desktop.query('GetInputFocus')).focus === focus.focus;
  const shape = await new Promise((resolve, reject) => desktop.client.require('shape', (error, ext) => error ? reject(error) : resolve(ext)));
  const inputShape = await new Promise((resolve, reject) => shape.GetRectangles(initial.window, 2, (error, value) => error ? reject(error) : resolve(value)));
  report.empty_input_shape = inputShape.rectangles.length === 0;
  assert(report.focus_unchanged_on_start && report.empty_input_shape, 'Overlay intercepted focus or input');
  publisher.emit('approval');
  const waiting = await waitFor(s => s.effect === 'approval');
  const owner = waiting.support.owner, x = waiting.x, y = waiting.y;
  desktop.send('ConfigureWindow', owner, { x: owner === ids[0] ? 60 : 410, y: owner === ids[0] ? 102 : 230 });
  const riding = await waitFor(s => s.rides > waiting.rides);
  report.rides_moving_window = Math.abs(riding.x - x - 60) < 4 && Math.abs(riding.y - y - 10) < 4;
  assert(report.rides_moving_window, `Foothold was not carried: ${JSON.stringify(riding)}`);
  publisher.emit('approval', 'end');
  publisher.emit('type'); await waitFor(s => s.state === 'type'); report.typing_reaction = true;
  publisher.emit('type', 'end'); await sleep(1000);
  publisher.emit('observe'); await waitFor(s => s.state === 'observe'); report.observation_reaction = true;
  publisher.emit('observe', 'end'); await sleep(1000);
  publisher.emit('click'); const hopping = await waitFor(s => s.jumps > riding.jumps); report.click_hop = true;
  await waitFor(s => s.landings > riding.landings);
  publisher.emit('error'); await waitFor(s => s.state === 'confused'); report.error_reaction = true;
  const perched = await waitFor(s => s.state === 'confused' && s.support && ids.includes(s.support.owner));
  const oldFalls = perched.falls;
  desktop.send('DestroyWindow', perched.support.owner);
  const falling = await waitFor(s => s.falls > oldFalls);
  await waitFor(s => s.landings > falling.landings, 5);
  report.falls_on_window_close = true;
  const end = await control(directory, 'status');
  report.ballistic_hops = end.jumps;
  report.states = end.history; report.received_events = end.events; report.memory_bytes = end.memory_bytes;
  console.log(JSON.stringify(report, null, 2));
} finally {
  publisher.close();
  try { await control(directory, 'stop'); } catch {}
  if (pet) await new Promise(r => { if (pet.exitCode !== null) r(); else { pet.once('exit', r); setTimeout(() => pet.kill('SIGTERM'), 2000).unref(); } });
  for (const id of ids) desktop.send('DestroyWindow', id);
  desktop.close();
  if (before.focus > 1) await promisify(execFile)('xdotool', ['windowfocus', String(before.focus)]).catch(() => {});
}
