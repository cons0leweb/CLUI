# Security policy

CLUI can inject input into the X11 session of the user who launches it. Treat access to the MCP server as equivalent to access to that desktop session.

## Supported versions

Security fixes are applied to the latest revision on the `main` branch while the project is pre-1.0.

## Reporting a vulnerability

Please use GitHub's private security advisory flow for `cons0leweb/CLUI`. Do not include credentials, private screenshots, typed text, or other sensitive desktop data in a public issue.

Useful reports include the affected revision, Linux/X11 environment, required capabilities, a minimal reproduction, and the security impact.

## Security invariants

- MCP stdout is reserved for protocol traffic.
- Client input must never be interpolated into a shell command.
- External executables must remain fixed and allowlisted.
- Every external process must have a timeout and bounded output.
- Typed text must not be logged verbatim by default.
- CLUI must not silently bypass Wayland or compositor security controls.
