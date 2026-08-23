# CLUI

[![CI](https://github.com/cons0leweb/CLUI/actions/workflows/ci.yml/badge.svg)](https://github.com/cons0leweb/CLUI/actions/workflows/ci.yml)

CLUI stands for Codex Linux UI Interaction. It is a local MCP server that lets an MCP client inspect and control an X11 desktop.

I wanted Codex to be able to start a GUI application, look at it, interact with it, and check the result. CLUI covers that loop without the Computer Use API or browser automation:

```text
observe -> decide -> act -> observe
```

It can list windows, focus one, take screenshots, move and click the mouse, and send keyboard input. Screenshots are returned as MCP image content, so the client can inspect them directly.

ScreenMap can also read the Linux accessibility tree and put numbered boxes around useful controls and text. This is optional; raw screenshots still work when accessibility data is missing.

## Current status

The server targets Linux/X11 and Node.js 20+. It is written in TypeScript, uses the MCP TypeScript SDK v2, and runs over stdio. Wayland sessions are detected but not supported yet.

## System packages

On Debian or Ubuntu:

```bash
sudo apt install xdotool x11-utils imagemagick
```

`maim` is the preferred screenshot command. `xrandr` is used for monitor layout:

```bash
sudo apt install maim x11-xserver-utils
```

`scrot` can be installed as a screenshot fallback:

```bash
sudo apt install scrot
```

ScreenMap uses the AT-SPI bus. On Debian and Ubuntu it is provided by `at-spi2-core`, which is normally installed with the desktop environment:

```bash
sudo apt install at-spi2-core
```

Package names differ between distributions. At startup, CLUI checks for:

```text
xdotool  xprop  xwininfo  xrandr  maim  import  convert  scrot
```

Missing commands are reported by `desktop_get_capabilities` and in stderr logs.

CLUI also needs access to the X11 session. Make sure `DISPLAY` and, when needed, `XAUTHORITY` are available to the process that starts it.

## Install

```bash
git clone git@github.com:cons0leweb/CLUI.git
cd CLUI
npm install
npm run build
```

Run the server with:

```bash
npm start
```

This runs `node dist/index.js`. stdout is reserved for MCP traffic. Logs go to stderr.

For development:

```bash
npm run dev
```

## Codex config

Add this to `~/.codex/config.toml` and adjust the paths:

```toml
[mcp_servers.clui]
command = "node"
args = ["/home/cons0leweb/JS/CLUI/dist/index.js"]
cwd = "/home/cons0leweb/JS/CLUI"
env_vars = ["DISPLAY", "XAUTHORITY", "XDG_SESSION_TYPE", "WAYLAND_DISPLAY"]
startup_timeout_sec = 10
tool_timeout_sec = 60
```

The same config is available in [`examples/codex.config.toml`](examples/codex.config.toml). The key names come from the [Codex configuration reference](https://developers.openai.com/codex/config-file/config-reference).

Restart Codex after adding the server. Call `desktop_get_capabilities` first to check the session and installed commands.

## Tools

| Area | Tools |
| --- | --- |
| Windows | `desktop_get_active_window`, `desktop_list_windows`, `desktop_find_window`, `desktop_get_window_info`, `desktop_focus_window` |
| Screen | `desktop_get_capabilities`, `desktop_screenshot`, `desktop_get_screen_info`, `desktop_observe` |
| ScreenMap | `desktop_observe_marked`, `desktop_get_elements`, `desktop_element_info`, `desktop_click_element`, `desktop_focus_element` |
| Mouse | `desktop_get_mouse_position`, `desktop_move_mouse`, `desktop_move_mouse_window`, `desktop_click`, `desktop_click_window`, `desktop_mouse_down`, `desktop_mouse_up`, `desktop_scroll` |
| Keyboard | `desktop_key_press`, `desktop_key_down`, `desktop_key_up`, `desktop_type_text` |
| Other | `desktop_wait`, `desktop_act` |

`desktop_wait` accepts up to 10 seconds. `desktop_act` accepts up to 20 actions. Supported actions are `focus`, `move`, `click`, `key`, `type`, `wait`, and `scroll`. It has no shell action.

### Window-relative coordinates

`desktop_move_mouse_window` and `desktop_click_window` can use pixels relative to a window or normalized coordinates between `0` and `1`.

This targets the center of a window:

```json
{
  "window_id": "0x4600007",
  "x": 0.5,
  "y": 0.5,
  "normalized": true
}
```

### Screenshots

`desktop_screenshot` supports four modes:

- `screen`
- `active_window`
- `window`
- `region`

It returns a PNG image block:

```json
{
  "type": "image",
  "data": "<base64>",
  "mimeType": "image/png"
}
```

`max_width` and `max_height` can be used to reduce the image size. ImageMagick `convert` handles the resize, keeps the aspect ratio, and does not upscale. Region coordinates are global screen coordinates.

Screenshot commands are tried in this order:

1. `maim`
2. ImageMagick `import`
3. `scrot`

`maim` and `import` can capture an X11 window by ID. With `scrot`, a window screenshot is taken from its screen rectangle, so another window may cover part of it.

`desktop_observe` returns the active window, mouse position, screen information, and a screenshot in one call. It can also include a window list summary.

## ScreenMap

`desktop_observe_marked` captures a window and reads its AT-SPI accessibility tree. The result contains a PNG with numbered boxes, a structured element list, and a `snapshot_id`.

For example, a snapshot may contain:

```text
[12] Address
[19] Security
[24] Save
```

Each element has a role, label, screen rectangle, basic states, and a source. `desktop_click_element` and `desktop_focus_element` accept the snapshot ID and element ID, so the client does not need to guess a coordinate.

Element IDs only belong to one snapshot. Snapshots stay in memory for 60 seconds, with at most 15 retained. A click is rejected if the snapshot expired, the window disappeared, or its geometry changed. Call `desktop_observe_marked` again after scrolling or a layout change.

The default filter keeps interactive controls, headings, meaningful text, and selected items. It removes invisible, zero-size, offscreen, generic, and redundant nodes. Results are ranked deterministically and limited to 150 elements by default. `max_elements` can raise the limit to 500.

`desktop_get_elements` filters an existing snapshot without rescanning the application. It supports role, label substring, visibility, and interaction filters. `desktop_element_info` returns one full element object.

If AT-SPI is unavailable or the application exposes no useful nodes, `desktop_observe_marked` still returns the window screenshot with `screen_map_available: false` and a reason. It does not enable ScreenMap for regular `desktop_observe` calls.

## Security

CLUI runs with the permissions of its user. A client connected to it can click buttons and type into any window in that X11 session. Do not expose the server over the network.

External commands are limited to a fixed allowlist:

```text
xdotool  xprop  xwininfo  xrandr  maim  import  convert  scrot
```

All commands go through `runCommand(executable, args, timeout)`. It uses `child_process.spawn` with `shell: false` and argument arrays. Client input is never concatenated into a shell command. Processes have timeouts and output limits, and a process that hangs is killed.

`desktop_type_text` passes the text as one argument to `xdotool`. Logs contain the text length, not the text itself.

Accessibility trees can contain private text. ScreenMap snapshots are never written to disk. Element labels and editable values are not logged. ScreenMap logs contain the backend, snapshot ID, element count, duration, and errors. The AT-SPI scan only runs after an explicit `desktop_observe_marked` call.

There are no MCP tools named `shell`, `exec`, `bash`, or `run_command`.

`ActionGuard` assigns one of three classes to each call:

- `read_only` for screenshots, ScreenMap observations, cached element queries, and state queries
- `interaction` for focus, element clicks, mouse, keyboard, and wait operations
- `high_impact` for shortcuts such as `Alt+F4` and modified Delete

The current policy logs the class but does not block `high_impact` calls. Approval logic can be added in `ActionGuard.authorize` without changing the tool handlers.

## Tests

```bash
npm test
```

The tests cover command execution, X11 parsing, coordinate conversion, schemas, action classification, ScreenMap filtering and ranking, annotation geometry, snapshot expiry and eviction, empty-tree fallback, click coordinates, stale-window rejection, cached element filtering, and privacy-safe log summaries.

There is also an X11 smoke test:

```bash
npm run smoke
```

It reads the active window, takes a full-screen screenshot, reads the mouse position, and lists windows. Each check is reported separately, which is useful when only some system packages are installed.

The smoke test does not move the pointer unless this flag is passed:

```bash
npm run smoke -- --move-mouse
```

## Demo

```bash
npm run demo
```

If Minecraft is running, the demo finds its window, focuses it, saves a screenshot, presses `Escape`, waits 500 ms, and saves another screenshot. Files are written under `artifacts/`.

If no Minecraft window is found, the demo only takes a screenshot of the active window. It does not click or send keyboard input to an unknown application.

## MCP Inspector

Build the server, then run:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

To list tools without opening the web interface:

```bash
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list
```

## Limitations

- Native Wayland support is not implemented. CLUI does not try to bypass compositor security rules.
- Window activation depends on the window manager accepting `_NET_ACTIVE_WINDOW`.
- X11 does not isolate applications from each other. A process connected to the display can usually observe windows and inject input.
- Window decorations are handled differently by different window managers. Geometry comes from `xwininfo`.
- `xdotool type` Unicode support depends on the current keyboard layout and input method. Spaces, punctuation, and newlines are passed literally.
- Horizontal scrolling uses X11 buttons 6 and 7. Some applications ignore them.
- Screenshots may fail on a locked session, protected surfaces, nested displays, or restrictive ImageMagick policies.
- Monitor layout requires `xrandr`. Root screen dimensions are still available without it.
- CLUI does not run OCR. The MCP client receives the screenshot and analyzes it.
- ScreenMap only sees information published through AT-SPI. Canvas content, games, custom-rendered controls, and applications with accessibility disabled may return no elements.
- CLUI enables the standard AT-SPI session status when a marked observation starts. Some already-running applications, including Firefox builds, may need to be restarted before they appear on the accessibility bus.
- ScreenMap currently maps an X11 window to an AT-SPI application by accessible window title/application name. Applications with several identical untitled windows may not resolve.
- Annotations use ImageMagick `convert`. Without it, structured accessibility data is still available but the PNG is not marked.
- Wayland ScreenMap is not implemented.

If `DISPLAY` is missing and `WAYLAND_DISPLAY` is set, the server still starts. `desktop_get_capabilities` reports the Wayland session, and desktop operations return an X11-specific error.

## Troubleshooting

- `Required executable 'xdotool' is unavailable`: install `xdotool`, restart the server, and call `desktop_get_capabilities` again.
- Missing `xwininfo` or `xprop`: install the package that provides them. On Debian and Ubuntu, both are in `x11-utils`.
- `No screenshot utility found`: install `maim`, ImageMagick, or `scrot`.
- `Can't open display`: check `DISPLAY`, `XAUTHORITY`, and the user running the MCP process.
- Focus timeout: the window manager may have rejected activation, or the window may have closed. List the windows again and retry with the new ID.
- Wrong characters from `desktop_type_text`: check the X11 keyboard layout and input method. CLUI does not use a clipboard fallback.
- `screen_map_available: false`: check `DBUS_SESSION_BUS_ADDRESS`, make sure `at-spi2-core` is running, and restart the target application after the first marked observation if it was started with accessibility disabled.

## Source layout

```text
src/
  accessibility/ AccessibilityBackend and AT-SPI D-Bus implementation
  backend/    DesktopBackend, X11 implementation, capability checks, parsers
  safety/     action classification and approval hook
  screenmap/  filtering, ranking, snapshot cache, annotations, interactions
  system/     command runner and PNG helpers
  tools/      MCP schemas and tool registration
  types/      desktop and ScreenMap types
  index.ts    startup and stdio transport
  server.ts   MCP server setup
scripts/      smoke test and Minecraft demo
tests/        unit tests
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) before changing the backend or command allowlist. Security reports should follow [`SECURITY.md`](SECURITY.md).
