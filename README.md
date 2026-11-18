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

# Optional: clipboard and window maximize/restore
sudo apt install xclip wmctrl
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
xdotool  xprop  xwininfo  xrandr  maim  import  convert  scrot  xclip  wmctrl  python3
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
| ScreenMap | `desktop_observe_marked`, `desktop_get_elements`, `desktop_element_info`, `desktop_click_element`, `desktop_focus_element`, `desktop_get_element_actions`, `desktop_perform_element_action` |
| Mouse | `desktop_get_mouse_position`, `desktop_move_mouse`, `desktop_move_mouse_window`, `desktop_click`, `desktop_click_window`, `desktop_mouse_down`, `desktop_mouse_up`, `desktop_scroll` |
| Keyboard | `desktop_key_press`, `desktop_key_down`, `desktop_key_up`, `desktop_type_text` |
| Clipboard | `desktop_read_clipboard`, `desktop_write_clipboard` |
| Window management | `desktop_configure_window`, `desktop_list_surfaces` |
| Element interaction | `desktop_scroll_element`, `desktop_drag_element`, `desktop_read_element_text`, `desktop_read_window_text` |
| Drag | `desktop_drag` |
| Cursor indicator | `desktop_control_session` |
| Other | `desktop_wait`, `desktop_act` |

`desktop_wait` accepts up to 10 seconds. `desktop_act` accepts up to 20 actions. Supported actions are `focus`, `move`, `click`, `key`, `type`, `wait`, and `scroll`. It has no shell action.

### Window-relative coordinates

`desktop_move_mouse_window` and `desktop_click_window` can use pixels relative to a window or normalized coordinates between `0` and `1`.

This targets the center of a window:

```json
{
  "session_id": "<action_session_id from capabilities>",
  "request_id": "click-window-center-001",
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


### Cursor activity indicator

On X11, CLUI shows a turquoise ring around the pointer and a live action/target label during
interaction tools, for example `Клик → Сохранить · Editor` or
`Ввод текста → Firefox`. ScreenMap actions use accessible names; coordinate
actions show the window under the pointer and coordinates. Keyboard actions
show the active window. These are observations before dispatch, not a focus lock.
Typed text, clipboard contents, and editable values are never used as labels.
Window titles and accessible names can still contain private information. Labels
are limited to 120 Unicode characters and truncated to fit the screen. Each step
of `desktop_act` updates the label separately. Read-only tools update it within
an explicit control session; they do not start the indicator by themselves. A click or mouse-down briefly expands the ring. The indicator
follows the pointer at up to 30 frames per second, does not accept focus, and has
an empty input shape so clicks pass to the application underneath. It uses a
shaped X11 window and works without a compositing manager.

For a visible session across observations and pauses, call:

```json
{ "action": "begin", "timeout_ms": 60000 }
```

with `desktop_control_session`. End with `{ "action": "end" }`; inspect using
`{ "action": "status" }`. Sessions expire after their requested timeout (maximum
10 minutes); call begin again to renew. Without an explicit session, the ring
remains visible during each interaction and for three seconds afterward. Read-only
observations do not start it. Ending a session does not hide an interaction still
in progress. The indicator marks CLUI activity; it does not distinguish physical
mouse movement or prevent user input.

The helper requires `python3`, `libX11.so.6`, `libXext.so.6`, `libXft.so.2` (Unicode text), and the X11 SHAPE 1.1
extension. No Python packages or GTK bindings are needed. It starts lazily on the
first interaction and communicates using bounded JSON show/pulse/hide/quit messages with a display-only label.
Its stdout is captured separately from MCP. If unavailable, CLUI logs the failure
and continues; status reports `available: false`. Before startup completes,
`available` is null. Set `CLUI_CURSOR_INDICATOR=0` in the server environment to
disable it. No helper runs in a Wayland-only session.

The overlay is excluded from the ordinary window list and surface discovery.
It can appear in full-screen/region screenshots. On server shutdown, stdin EOF,
or six seconds without the server heartbeat, it disappears. It is packaged in
`dist/indicator/` by the build. To use it after upgrading, restart the CLUI server.

### Clipboard, containers, dragging, and window management

`desktop_read_clipboard` and `desktop_write_clipboard` transfer literal UTF-8 text
through `xclip`. Writing replaces the current clipboard but does not send a paste
shortcut. Use `desktop_key_press` with Ctrl+V (or Ctrl+Shift+V in terminals) to
paste after focusing the destination. Reads are limited to 4 MiB; writes to
1,000,000 JavaScript string units. Clipboard content is not logged. The xclip
selection owner runs in the background until another application replaces the
clipboard; it may remain after CLUI exits. Clipboard operations do not preserve
the previous contents.

`desktop_scroll_element` accepts `snapshot_id`, `element_id`, `delta_x`, and
`delta_y` (wheel steps, positive Y scrolls down). It checks the element and window
geometry, moves the pointer into the container, and sends wheel events. Unnamed
scroll panes and viewports are included in ScreenMap. Nested controls may intercept
the wheel. Observe again after scrolling.

`desktop_drag` accepts absolute `from`/`to` points; `desktop_drag_element` accepts
`from_element_id` and `to_element_id` in one snapshot. Both accept `button` and
`duration_ms` (100–5000, default 600), and attempt button release even when movement
fails. Existing held mouse buttons must be released first. Element dragging checks
both endpoints before starting; applications can still change layout during a drag.

`desktop_read_element_text` reads a live AT-SPI Text range using `start_offset`
and `length` (maximum 100,000 Unicode characters). This can include offscreen
content exposed by that element. `desktop_read_window_text` traverses the window's
accessibility nodes without requiring visible geometry and returns text `blocks`
and `partial`. It is bounded by `max_characters` (default 20,000, maximum 100,000),
3,000 nodes, and an eight-second traversal deadline. Its output budget counts
JavaScript string units. Parent and child text representations may overlap.
Password roles are excluded. Applications may expose only loaded/virtualized
content; these tools do not run OCR or automatically scroll to load more text.
Text reads are explicit, live queries and do not verify that text is unchanged
since the snapshot. Text content is not logged.

`desktop_configure_window` accepts `window_id`, optional `x`, `y`, `width`,
`height`, and `state` (`maximize`, `minimize`, or `restore`). Unspecified dimensions
are preserved. Maximize/restore require `wmctrl`. The result contains observed
window geometry; the window manager can constrain or asynchronously apply a
request. Restore maps a minimized window and removes maximization.

`desktop_list_surfaces` discovers mapped menus, dropdowns, tooltips, dialogs, and
notifications from the X window tree, including override-redirect windows missing
from the normal window list. It returns `surfaces` and `partial`, with a limit of
500 inspected windows and an eight-second enumeration deadline. Use returned IDs
with `desktop_screenshot` or `desktop_observe_marked` to inspect a surface and its
accessibility elements when exposed. Untyped popups and surfaces rendered inside
a parent window cannot be identified as separate X11 surfaces. AT-SPI matching
remains heuristic, and popups may disappear between calls. Element interactions
still require the captured window to be active; override-redirect menus often
need coordinate clicks based on the screenshot instead.

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

The [action execution contract](docs/action-execution.md) defines the shared
execution policy for standalone tools and each `desktop_act` step.

CLUI runs with the permissions of its user. A client connected to it can click buttons and type into any window in that X11 session. Do not expose the server over the network.

External commands are limited to a fixed allowlist:

```text
xdotool  xprop  xwininfo  xrandr  maim  import  convert  scrot  xclip  wmctrl  python3
```

Finite commands go through `runCommand(executable, args, timeout)`. The persistent cursor helper uses the same allowlisted `spawnAllowedCommand` boundary with a fixed packaged Python entry point. It uses `child_process.spawn` with `shell: false` and argument arrays. Client input is never concatenated into a shell command. Processes have timeouts and output limits, and a process that hangs is killed.

`desktop_type_text` passes the text as one argument to `xdotool`. Logs contain the text length, not the text itself.

Accessibility trees can contain private text. ScreenMap snapshots are never written to disk. Element labels and editable values are not logged. ScreenMap logs contain the backend, snapshot ID, element count, duration, and errors. The AT-SPI scan only runs after an explicit `desktop_observe_marked` call.

There are no MCP tools named `shell`, `exec`, `bash`, or `run_command`.

`ActionGuard` assigns one of three classes to each call:

- `read_only` for screenshots, ScreenMap observations, cached element queries, and state queries
- `interaction` for focus, element clicks, mouse, keyboard, and wait operations
- `high_impact` for shortcuts such as `Alt+F4` and modified Delete

High-impact actions require a human response through MCP form elicitation. The
current provider supports the SDK's legacy stdio elicitation path. If the client
or protocol mode does not support it, the action returns `approval_unavailable`.
Declined confirmation returns `approval_denied`; the timeout is 30 seconds.
Approval is bound to one request step. CLUI validates the target before approval,
after approval, and at each backend input dispatch boundary. An agent-supplied
`confirmed` field is rejected by mutation schemas and cannot grant approval.

The policy covers recognized destructive keys (including F4 and Delete even
without declared modifiers), Ctrl+Q/Ctrl+W, held key presses, destructive named
element actions, and all explicit AT-SPI semantic invocations. Classification is
not a complete interpretation of arbitrary screen pixels or application behavior.
Raw coordinate clicks can have effects the policy cannot identify.

### Action requests and preconditions

First call `desktop_get_capabilities` and read `action_session_id`. Every desktop
mutation (including `desktop_wait`) requires that value as `session_id` and a
caller-generated `request_id`. Read-only tools and the visual-only
`desktop_control_session` do not require these fields. Existing tool names and
operation arguments are retained, but callers must add the execution envelope.
For example:

```json
{
  "session_id": "<action_session_id from capabilities>",
  "request_id": "type-search-001",
  "expected_window_id": "0x4600007",
  "text": "search query"
}
```

Use this with `desktop_type_text`. `key`, `type`, and `scroll` require an explicitly
expected active window. Other pointer input such as clicks and dragging also
requires an expected active window; window-relative and ScreenMap inputs can
supply that identity through their target. Missing, mismatching, or unreadable
window state blocks dispatch. A cached element is checked against its live
accessible name, role, availability, and geometry; it is not enough merely to
retain its snapshot ID.

Additional conditions have this form:

```json
{
  "preconditions": {
    "active_window_id": "0x4600007",
    "element": {
      "snapshot_id": "<snapshot UUID>",
      "element_id": 24,
      "name": "Save"
    }
  }
}
```

A `desktop_act` request has the same `session_id` and `request_id` fields and may
specify top-level default preconditions and `expected_window_id`. Individual
steps can override these. Each step is checked and authorized independently.
After a focus step, explicitly target the new window in subsequent input steps.
There is no automatic assumption that whichever window is active is intended.

Actions return a structured envelope with `status`, `completed_steps`,
`failed_step`, `reason`, `expected`, `actual`, `dispatch_results`, and
`observation`. Standalone actions use step zero. `dispatched` and
`completed_steps` mean backend acknowledgment, not proof that the application
achieved the intended result. The current post-action observation reports the
active window and capture time (or unavailability); it is not a screenshot or a
success detector.

Failures before dispatch distinguish `precondition_failed`, `precondition_unknown`,
`approval_denied`, `approval_unavailable`, and `dispatch_failed`. A failure after
possible or partial input returns `outcome_unknown`. CLUI does not automatically
retry or switch to physical clicking. Before a new mutating request after such an
outcome, obtain a fresh `desktop_observe` or `desktop_observe_marked` result.
An observation started before the uncertainty cannot satisfy this requirement.
The executor's own post-action metadata does not clear it.

Identical duplicate requests, including concurrent ones, return the retained
result without repeating dispatch or approval. Reusing a request ID with different
arguments returns `request_conflict`. The journal retains up to 1,000 requests
per server session without eviction; at capacity, new requests are blocked.
Restarting creates a new session ID and rejects old-session requests. Results
are not durable across restarts. CLUI serializes its own mutating requests; it
does not isolate the desktop from physical input or other server processes.

The backend rechecks focus immediately before each input command. Focus checking
and X11 input injection are not atomic, and a command can inject multiple events;
this does not eliminate all races during a long input sequence. AT-SPI action-list
lookup and invocation are separate operations too. Cancellation
blocks later dispatch boundaries but cannot retract events already sent. Drag
cleanup releases only the button CLUI itself began holding, even if changed
conditions stopped the drag; it never retries the original action.

### Semantic accessibility actions

`desktop_get_element_actions` reads live action names, descriptions, and keybindings
for a retained `snapshot_id` and `element_id`. `desktop_perform_element_action`
accepts the same target plus an exact `action_name`, `session_id`, and `request_id`.
It validates the target, requests human approval, and invokes AT-SPI `DoAction`.
Unsupported or ambiguous names fail before invocation. A lost reply or negative
acknowledgment after invocation is uncertain and never causes a click fallback.
Accessibility focus also does not fall back to a click after an attempted
`GrabFocus` that failed or did not acknowledge success.

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
  actions/    shared execution, preconditions, replay journal, dispatch scopes
  indicator/  cursor activity lifecycle and fixed X11 overlay helper
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
