# Contributing to CLUI

Thanks for helping improve CLUI. Keep changes focused on its purpose: a small, transparent Linux desktop interaction layer over MCP.

## Development setup

Use Node.js 20 or newer:

```bash
npm ci
npm run build
npm test
```

For local X11 development, install the system packages listed in the README. The unit suite does not require an active display. `npm run smoke` does require X11 utilities and a usable `DISPLAY`.

## Design boundaries

The accepted [action execution contract](docs/action-execution.md) governs
action execution. It specifies shared standalone/batch execution,
fail-closed checks, trusted approval, uncertain outcomes, and replay protection.
Keep the runtime limits and supported approval transport documented in README.

- Desktop semantics belong behind `DesktopBackend`.
- X11 command output parsing belongs in `src/backend/x11Parsers.ts`.
- MCP handlers should validate and translate inputs, not implement X11 mechanics.
- Every external process must go through the fixed allowlist in `src/system/runCommand.ts`. Finite commands use `runCommand`; the persistent cursor indicator uses `spawnAllowedCommand` with its fixed packaged helper. Do not expose executable names or Python code through MCP inputs.
- Do not add shell, arbitrary executable, browser automation, or implicit OCR tools.
- New high-impact behavior must be classified centrally in `ActionGuard`.

## Pull requests

Before opening a pull request:

1. Add or update tests for changed behavior.
2. Run `npm run build` and `npm test`.
3. Update the README when tools, dependencies, security behavior, or limitations change.
4. Keep generated `dist/`, screenshots, credentials, and local environment files out of Git.

CI intentionally runs only deterministic build and unit checks. Interactive X11 smoke tests remain local because GitHub-hosted runners do not provide the target desktop session.
