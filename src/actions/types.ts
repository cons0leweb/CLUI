export type ExecutionStatus = "dispatched" | "precondition_failed" | "precondition_unknown" | "approval_denied" | "approval_unavailable" | "dispatch_failed" | "outcome_unknown" | "request_conflict";
export class ActionFailure extends Error {
  constructor(readonly status: ExecutionStatus, readonly reason: string, readonly expected: unknown = null, readonly actual: unknown = null) { super(reason); }
}
export interface ExecutionResult {
  status: ExecutionStatus;
  completed_steps: number[];
  failed_step: number | null;
  reason: string | null;
  expected: unknown;
  actual: unknown;
  dispatch_results: unknown[];
  observation: unknown;
}
export interface ActionInput {
  session_id?: string | undefined; request_id?: string | undefined; expected_window_id?: string | undefined; window_id?: string | undefined;
  snapshot_id?: string | undefined; element_id?: number | undefined; from_element_id?: number | undefined; to_element_id?: number | undefined; action_name?: string | undefined;
  preconditions?: { active_window_id?: string | undefined; element?: { snapshot_id: string; element_id: number; name?: string | undefined } | undefined } | undefined;
  [key: string]: unknown;
}
export interface ActionStep { name: string; input: ActionInput; run(): Promise<unknown> }
