# Action execution contract

Status: implemented shared execution contract. Implementation provides
session-scoped replay protection, live preconditions, legacy MCP form approval
(fail-closed in unsupported modes), and explicit semantic AT-SPI actions.
See README for public arguments, classification scope, and runtime limits.
CLUI remains a desktop interaction server. Terminal, LSP, and Git integrations
belong to other servers.

## Execution path

```text
MCP tool / each desktop_act step
  -> Precondition Validator
  -> ActionGuard / trusted human approval
  -> repeat precondition and focus validation
  -> X11 / AT-SPI backend dispatch
  -> dispatch outcome
  -> separate post-action observation
```

Single-action tools retain their names and dedicated interfaces. They and each
batch step use the same executor, validator, authorization policy, dispatch
boundary, and result contract. An outer batch check never substitutes for checks
on its individual steps. MCP handlers validate and translate arguments; they do
not implement a second execution policy.

## Preconditions

Preconditions can require the expected window to be active, the element to exist,
its accessible name to match the expected name, and the element to be available
for the requested action. Resolve and validate live accessibility data; a cached
snapshot alone cannot prove a name or availability still matches.

For every `key`, `type`, and `scroll` dispatch, validate the explicitly expected
window immediately before sending the event. Never adopt whichever window is
currently active as the intended target. This rule applies to standalone tools,
individual batch steps, and backend fallbacks that would send input.

Validate before authorization and repeat validation after authorization. Human
approval can take long enough for the target, focus, geometry, or accessible name
to change. A failed second check blocks dispatch even if approval was granted.

Fail closed. A mismatching condition and an unverifiable condition are different
results, but both prevent dispatch. Inability to read the active window, retrieve
an AT-SPI object, or evaluate a required condition is never permission to proceed.
Do not suppress these failures or silently fall back to an unchecked click.

X11 focus validation and event injection are not atomic. Keep the interval small,
but do not claim that this eliminates focus races or locks out physical input.

## Authorization

`ActionGuard` owns classification and authorization. High-impact actions require
an actual human decision from a trusted client interface. An agent-supplied
`confirmed: true` or equivalent assertion cannot grant authorization.

Bind approval to the action, target, required conditions, and request identity.
An approval cannot authorize a changed action or a different target. Denial,
timeout, or an unavailable approval channel blocks dispatch. Approval must not
cause earlier completed batch steps to be replayed.

The exact trusted approval transport is an implementation decision. Do not ship a
placeholder that treats unsupported confirmation as approval.

## Structured execution results

Expected execution outcomes are tool results, not prose-only errors or MCP
protocol failures. Reserve protocol errors for malformed arguments and protocol
failures. Use this shape for both standalone actions and batches:

```json
{
  "status": "precondition_failed",
  "completed_steps": [0, 1],
  "failed_step": 2,
  "reason": "active_window_mismatch",
  "expected": "Minecraft",
  "actual": "Codex"
}
```

Step indexes are zero-based. A standalone action is step zero. Each result has
`status`, `completed_steps`, `failed_step`, `reason`, `expected`, and `actual`;
use null when a field is not applicable. `completed_steps` means backend-accepted
steps, not proof of user-level success. Stop a batch at the first blocked,
failed, or uncertain step.

| Status | Meaning |
| --- | --- |
| `dispatched` | The backend acknowledged all requested steps; application-level success remains unproven. |
| `precondition_failed` | A required condition was checked and did not match. No input was sent for the failed step. |
| `precondition_unknown` | A required condition could not be checked. No input was sent for the failed step. |
| `approval_denied` | The human denied authorization. No input was sent for the failed step. |
| `approval_unavailable` | Confirmation could not be obtained, including timeout. No input was sent for the failed step. |
| `dispatch_failed` | The backend can establish that input was not dispatched for the failed step. |
| `outcome_unknown` | The step may have been dispatched or partially applied; its effect is uncertain. |
| `request_conflict` | A retained request ID was reused with different arguments. Nothing new was dispatched. |

Reasons are stable machine-readable codes, for example
`active_window_mismatch`, `active_window_unavailable`, `element_not_found`,
`element_name_mismatch`, and `accessibility_unavailable`. Unknown actual values
are null, rather than guessed. Backend errors carry bounded diagnostic context;
they must not leak typed text, clipboard contents, or editable values into logs.

## Uncertain outcomes and repeated requests

Treat errors after possible dispatch as `outcome_unknown`, for both X11 and
AT-SPI. A D-Bus timeout or error after sending `DoAction` does not establish that
the application did nothing. Neither does an X11 command error after partial
input injection.

Never automatically retry such a step or replace it with a physical click.
Return the uncertainty and require fresh observation before deciding on another
action. Observation alone does not authorize replay or resolve uncertainty.

Every mutating request needs an identity. Reserve that identity before validation
or dispatch, bind it to the normalized arguments, and retain its result. Duplicate
requests, including simultaneous duplicates, must share the original execution
and return its result. Reusing an ID with different arguments is a conflict.
Retain `outcome_unknown` just like other terminal results. Repeating a batch ID
must not replay its completed prefix or uncertain step.

The guarantee must have an explicit retention and restart scope. Never advertise
exactly-once execution in the application. Do not silently evict retained IDs and
then accept their retransmissions as new actions. If the implementation uses
session-scoped memory, bind IDs to that server session and reject requests from
an expired session after restart. A durable implementation must preserve pending
records and treat interrupted dispatches as uncertain during recovery.

## AT-SPI semantics

Discover the actions supported by an element and invoke the requested semantic
action by name where supported. Validate its identity and conditions through the
same executor. Unsupported semantic actions fail before dispatch. Physical input
is a separately selected method, never an automatic retry of an uncertain
semantic action.

## Post-action observation

Return post-action observation separately from the dispatch outcome. It reports
what was observed, including missing or unavailable evidence; it does not turn
`dispatched` into application-level success or `outcome_unknown` into failure.
Failure to capture an observation must not discard the recorded dispatch result
or trigger another dispatch. Observations are read-only and bounded.

## Ownership

- `src/tools/`: MCP schemas, argument translation, batch step sequencing.
- `src/actions/`: shared execution, preconditions, replay
  protection, result types, and bounded observation orchestration.
- `src/safety/`: authorization policy and trusted approval integration.
- `src/backend/`: X11 operations and the final input dispatch boundary.
- `src/accessibility/`: live AT-SPI reads, supported actions, semantic dispatch.
- `src/screenmap/`: snapshot identity and geometry, without a second policy engine.

Backends expose enough dispatch information to distinguish definite non-dispatch
from uncertain outcomes. The shared executor owns the public result. Indicator
captions remain presentation metadata and cannot satisfy a precondition or grant
approval.

## Required verification

- Focus changes between batch steps block the next key, type, or scroll event.
- Focus or element identity changes during approval block dispatch afterward.
- Unavailable window/accessibility state fails closed for standalone and batch tools.
- Denied, missing, expired, or agent-asserted approval never authorizes input.
- A post-send X11/AT-SPI failure produces `outcome_unknown` without retry/fallback.
- Concurrent duplicates and repeated batch IDs dispatch at most one execution
  within the documented retention scope; argument conflicts do not dispatch.
- Completed prefixes, uncertain steps, and observations remain distinct in results.
- Observation failure preserves the dispatch record and never repeats the action.

## Runtime notes

The current journal retains 1,000 entries without eviction, bound to a random
server session ID. Post-action observation is active-window metadata. Client
cancellation blocks later dispatch boundaries but cannot retract existing input.
Drag cleanup may release the button CLUI itself began holding after conditions
change; that bounded release is not an action retry or a fallback.
