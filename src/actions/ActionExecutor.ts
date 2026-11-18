import { createHash, randomUUID } from "node:crypto";
import type { DesktopBackend } from "../backend/DesktopBackend.js";
import type { ActionGuard } from "../safety/ActionGuard.js";
import type { PreconditionValidator } from "./PreconditionValidator.js";
import { withDispatchScope } from "./dispatchScope.js";
import { ActionFailure, type ActionStep, type ExecutionResult } from "./types.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export class ActionExecutor {
  readonly sessionId = randomUUID();
  private readonly requests = new Map<string, { digest: string; result: Promise<ExecutionResult> }>();
  private queue: Promise<unknown> = Promise.resolve();
  private observationRequired = false;
  constructor(private readonly desktop: DesktopBackend, private readonly validator: PreconditionValidator, private readonly guard: ActionGuard, private readonly capacity = 1_000) {}
  observationToken = 0;
  getStatus() { return { retained_requests: this.requests.size, capacity: this.capacity, requires_fresh_observation: this.observationRequired, retention: "server_session_no_eviction" }; }
  markObserved(token = this.observationToken): void { if (token === this.observationToken) this.observationRequired = false; }
  execute(identity: Record<string, unknown>, steps: ActionStep[], signal?: AbortSignal): Promise<ExecutionResult> {
    const failure = (status: ExecutionResult["status"], reason: string) => Promise.resolve(this.result(status, [], 0, reason));
    if (identity.session_id !== this.sessionId) return failure("precondition_unknown", "session_expired_or_invalid");
    if (typeof identity.request_id !== "string" || !identity.request_id) return failure("precondition_unknown", "request_id_required");
    const digest = createHash("sha256").update(JSON.stringify(canonical({ identity, steps: steps.map(({ name, input }) => ({ name, input })) }))).digest("hex");
    const existing = this.requests.get(identity.request_id);
    if (existing) return existing.digest === digest ? existing.result : failure("request_conflict", "request_arguments_changed");
    if (this.requests.size >= this.capacity) return failure("precondition_unknown", "request_capacity_exhausted");
    const result = this.queue.then(() => this.run(steps, identity.request_id as string, signal));
    this.requests.set(identity.request_id, { digest, result });
    this.queue = result.catch(() => {});
    return result;
  }
  private result(status: ExecutionResult["status"], completed: number[], failed: number | null, reason: string | null = null, expected: unknown = null, actual: unknown = null, results: unknown[] = []): ExecutionResult {
    return { status, completed_steps: completed, failed_step: failed, reason, expected, actual, dispatch_results: results, observation: null };
  }
  private async run(steps: ActionStep[], requestId: string, signal?: AbortSignal): Promise<ExecutionResult> {
    const completed: number[] = [], results: unknown[] = [];
    if (this.observationRequired) return this.result("precondition_unknown", [], 0, "fresh_observation_required");
    for (const [index, step] of steps.entries()) {
      const state = { attempted: false, assertActive: () => { if (signal?.aborted) throw new ActionFailure("precondition_unknown", "request_cancelled"); }, validate: async () => {
        if (signal?.aborted) throw new ActionFailure("precondition_unknown", "request_cancelled");
        await this.validator.validate(step);
        if (signal?.aborted) throw new ActionFailure("precondition_unknown", "request_cancelled");
      } };
      try {
        await state.validate();
        const authorizationInput = this.validator.authorizationInput(step);
        await this.guard.authorize(step.name, this.guard.classify(step.name, authorizationInput), { ...authorizationInput, action_session_id: this.sessionId, request_id: requestId, step_index: index }, signal);
        await state.validate();
        results.push(await withDispatchScope(state, step.run));
        completed.push(index);
      } catch (error) {
        const failure = state.attempted ? new ActionFailure("outcome_unknown", "dispatch_may_have_applied")
          : error instanceof ActionFailure ? error : new ActionFailure("dispatch_failed", "not_dispatched");
        if (failure.status === "outcome_unknown") { this.observationRequired = true; this.observationToken += 1; }
        const result = this.result(failure.status, completed, index, failure.reason, failure.expected, failure.actual, results);
        result.observation = await this.observe();
        return result;
      }
    }
    const result = this.result("dispatched", completed, null, null, null, null, results);
    result.observation = await this.observe();
    return result;
  }
  private async observe(): Promise<unknown> {
    try { return { status: "available", active_window: await this.desktop.getActiveWindow(), captured_at: Date.now() }; }
    catch { return { status: "unavailable", reason: "active_window_unavailable" }; }
  }
}
