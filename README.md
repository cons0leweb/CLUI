# CLUI — Codex Linux UI Interaction

[![CI](https://github.com/cons0leweb/CLUI/actions/workflows/ci.yml/badge.svg)](https://github.com/cons0leweb/CLUI/actions/workflows/ci.yml)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

CLUI is a small standalone MCP server that gives a local agent a basic Linux desktop computer-use loop:

`observe → decide → act → observe`

It exposes X11 window discovery, focus verification, screenshots as MCP image content, mouse and keyboard input, window-relative coordinates, bounded action batches, and combined observations. It does **not** expose a shell, arbitrary executable names, Playwright, OCR, or remote-control infrastructure.

## Status

- Linux, X11 first
- Node.js 20+
- TypeScript, ESM
- MCP TypeScript SDK v2 (`@modelcontextprotocol/server`)
- stdio transport (`node dist/index.js`)
- Wayland backend: not implemented; a Wayland-only session is detected and reported without bypass hacks

## Requirements

Required for the full MVP on Debian/Ubuntu:

```bash
sudo apt install xdotool x11-utils imagemagick
```

Recommended for faster screenshots and monitor discovery:

```bash
sudo apt install maim x11-xserver-utils
```

Optional screenshot fallback:

```bash
sudo apt install scrot
```

Package names vary by distribution. CLUI detects `xdotool`, `xprop`, `xwininfo`, `xrandr`, `maim`, ImageMagick `import`/`convert`, and `scrot` at startup. Missing tools produce explicit capability errors rather than raw `ENOENT` failures.

An accessible X11 display is also required. When launching from a service or sandbox, forward `DISPLAY` and any required Xauthority environment deliberately.

## Install, build, and run

```bash
npm install
npm run build
npm start
```

`npm start` runs `node dist/index.js`. stdout is reserved for MCP JSON-RPC; structured diagnostics go only to stderr.

For development:

```bash
npm run dev
```

## Codex configuration

Add this to `~/.codex/config.toml` (replace the path if the project lives elsewhere):

```toml
[mcp_servers.clui]
command = "node"
args = ["/home/cons0leweb/JS/CLUI/dist/index.js"]
cwd = "/home/cons0leweb/JS/CLUI"
env_vars = ["DISPLAY", "XAUTHORITY", "XDG_SESSION_TYPE", "WAYLAND_DISPLAY"]
startup_timeout_sec = 10
tool_timeout_sec = 60
```

The names above follow the current official Codex configuration reference: local stdio servers use `mcp_servers.<id>.command`, `args`, `cwd`, and optional `env_vars`.

## MCP Inspector

Build first, then launch the Inspector against the stdio command:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

For a noninteractive tool-list check with current Inspector releases:

```bash
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list
```

In the web UI, connect, open **Tools**, call `desktop_get_capabilities`, then exercise read-only tools before interaction tools.

## Tools

Window and display observation:

- `desktop_get_capabilities`
- `desktop_get_active_window`
- `desktop_list_windows`
- `desktop_find_window`
- `desktop_get_window_info`
- `desktop_get_mouse_position`
- `desktop_get_screen_info`
- `desktop_observe`

Screenshots:

- `desktop_screenshot` with `screen`, `active_window`, `window`, or `region` mode
- optional `max_width` / `max_height` downscale when ImageMagick `convert` is available
- PNG returned inline as MCP `{ type: "image", data: <base64>, mimeType: "image/png" }`

Window and pointer interaction:

- `desktop_focus_window`
- `desktop_move_mouse`
- `desktop_move_mouse_window`
- `desktop_click`
- `desktop_click_window`
- `desktop_mouse_down`
- `desktop_mouse_up`
- `desktop_scroll`

Keyboard and orchestration:

- `desktop_key_press`
- `desktop_key_down`
- `desktop_key_up`
- `desktop_type_text`
- `desktop_wait` (maximum 10 seconds)
- `desktop_act` (maximum 20 GUI-only actions; no shell action)

Window-relative tools accept pixel coordinates or normalized values from `0` to `1`. For example, `{ "window_id": "0x4600007", "x": 0.5, "y": 0.5, "normalized": true }` targets the window center independently of screen resolution.

## Screenshot selection

CLUI selects the first available backend in this order:

1. `maim`
2. ImageMagick `import`
3. `scrot`

`maim` and `import` can capture a specific X11 window ID. The `scrot` fallback captures the window's current screen rectangle, so overlapping windows can appear in that fallback image. Region coordinates are global root-screen coordinates. Downscaling preserves aspect ratio and never upscales.

## Security model

CLUI is local and powerful: clicks and keystrokes have the same authority as the user running the process. Run it only in a desktop session and account you intend the agent to control.

The command boundary is intentionally narrow:

- one `runCommand(executable, args, timeout)` implementation owns subprocess execution;
- executable names are a compile-time fixed allowlist;
- every call uses `child_process.spawn` with `shell: false` and argument arrays;
- user text is passed as one literal `xdotool` argument, never interpolated into a command string;
- every subprocess has a timeout and output cap, and hung processes are killed;
- there is no MCP shell/exec/run-command tool;
- structured logs go to stderr and `desktop_type_text` logs only text length.

`ActionGuard` centrally classifies calls as:

- `read_only`: capabilities, window/screen/mouse observation, screenshots;
- `interaction`: focus, pointer actions, ordinary keyboard input, waits;
- `high_impact`: a small initial set of potentially destructive shortcuts such as `Alt+F4` and modified Delete.

The MVP records but does not block `high_impact`; `ActionGuard.authorize` is the single extension point for a future approval policy.

## Tests and smoke test

```bash
npm test
npm run smoke
```

Unit tests cover command execution, timeout and ENOENT typing, literal argument safety, X11 geometry parsing, xprop parsing, window filtering, normalized coordinates, schemas, batch limits, and action classification.

The smoke script reads the active window, takes a screenshot, reads mouse position, and lists windows. It does not move the pointer unless explicitly invoked with:

```bash
npm run smoke -- --move-mouse
```

## Safe demo flow

```bash
npm run demo
```

If a visible Minecraft window exists, the demo focuses it, captures a before image, presses `Escape`, waits 500 ms, and captures an after image under `artifacts/`. It never clicks an unknown coordinate. If Minecraft is absent, it performs an observe-only screenshot of the active window and sends no input.

## X11 limitations

- Window activation depends on an EWMH-compatible window manager honoring `_NET_ACTIVE_WINDOW`.
- X11 has no strong application isolation: any process connected to the display may generally observe or inject input.
- `xdotool type` Unicode behavior depends on the active keyboard layout/input method; spaces, punctuation, and multiline text are passed literally.
- Window geometry can include decorations differently across window managers; CLUI uses `xwininfo` absolute geometry.
- Horizontal scrolling uses conventional X11 buttons 6/7 and is not supported by every application.
- Screenshots may fail in locked sessions, protected surfaces, nested displays, or when ImageMagick policy disables X11 capture.
- Multi-monitor layout requires `xrandr`; root size remains available without it.
- No automatic OCR is performed; the MCP client receives the image for visual analysis.

## Wayland

Wayland is intentionally not automated in this MVP. If `DISPLAY` is absent and only `WAYLAND_DISPLAY` exists, CLUI starts its MCP surface, reports the session in `desktop_get_capabilities`, and returns a clear X11-required error from desktop operations. A future `WaylandBackend` can implement the same `DesktopBackend` interface using explicit compositor/portal support.

## Troubleshooting

- **`xdotool` unavailable**: install it, restart CLUI, and call `desktop_get_capabilities` again.
- **`xwininfo` or `xprop` unavailable**: install your distribution's `x11-utils` package.
- **No screenshot backend**: install `maim`, ImageMagick, or `scrot`.
- **`Can't open display`**: verify `DISPLAY`, Xauthority permissions, and that Codex launches CLUI in the same graphical session.
- **Wayland-only error**: log into an X11 session or run the target under a deliberately configured XWayland environment; native Wayland is not yet implemented.
- **Focus timeout**: the window manager denied activation, the window closed, or its ID changed; list/find it again.
- **Unicode typing mismatch**: configure the X11 keyboard/input method or paste through the target application manually; CLUI does not use a clipboard helper in this MVP.

## Architecture

```text
src/
  backend/    DesktopBackend contract, capability detection, X11 implementation/parsers
  safety/     centralized action classification and future authorization hook
  system/     allowlisted subprocess runner and PNG metadata
  tools/      MCP schemas and narrowly scoped tool registration modules
  types/      desktop domain types
  server.ts   composition only
  index.ts    startup, diagnostics, stdio transport
scripts/      read-only smoke test and safe Minecraft demo
tests/        unit tests
```

This boundary keeps X11 mechanics out of MCP handlers and leaves room for a later `WaylandBackend` without changing the public tool surface.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and architecture boundaries. Report vulnerabilities through GitHub private security advisories as described in [SECURITY.md](SECURITY.md).
