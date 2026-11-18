import { describe, expect, it, vi } from "vitest";
import { ActionExecutor } from "../src/actions/ActionExecutor.js";
import { PreconditionValidator } from "../src/actions/PreconditionValidator.js";
import { dispatchInput } from "../src/actions/dispatchScope.js";
import { ActionGuard, type ApprovalProvider } from "../src/safety/ActionGuard.js";
import { ScreenMapService } from "../src/screenmap/ScreenMapService.js";
import { FakeAccessibility, FakeDesktop, accessibilityElement } from "./screenMapFixtures.js";
import { AnnotationRenderer } from "../src/screenmap/AnnotationRenderer.js";

function fixture(approval?: ApprovalProvider, capacity = 1_000) {
  const desktop = new FakeDesktop();
  const accessibility = new FakeAccessibility();
  const renderer = new AnnotationRenderer(async (_args, input) => input);
  const screenMap = new ScreenMapService(desktop, accessibility, undefined, renderer);
  const executor = new ActionExecutor(desktop, new PreconditionValidator(desktop, screenMap), new ActionGuard(approval), capacity);
  const identity = (request_id = "request") => ({ session_id: executor.sessionId, request_id });
  const sent = vi.fn(async () => "accepted");
  const step = (input: Record<string, unknown> = {}, name = "desktop_type_text") => ({ name, input: { expected_window_id: desktop.window.id, ...input }, run: () => dispatchInput(sent) });
  return { desktop, accessibility, screenMap, executor, identity, sent, step };
}

describe("shared action execution", () => {
  it("requires an explicit target for keyboard input", async () => {
    const f = fixture();
    const result = await f.executor.execute(f.identity(), [{ ...f.step(), input: {} }]);
    expect(result).toMatchObject({ status: "precondition_unknown", reason: "expected_window_required", completed_steps: [], failed_step: 0 });
    expect(f.sent).not.toHaveBeenCalled();
  });

  it("fails closed when the active window is unknown or mismatches", async () => {
    const f = fixture();
    vi.spyOn(f.desktop, "getActiveWindow").mockRejectedValue(new Error("X server unavailable"));
    expect(await f.executor.execute(f.identity(), [f.step()])).toMatchObject({ status: "precondition_unknown" });
    expect(f.sent).not.toHaveBeenCalled();
    vi.mocked(f.desktop.getActiveWindow).mockResolvedValue({ ...f.desktop.window, id: "0x999" });
    expect(await f.executor.execute(f.identity("second"), [f.step()])).toMatchObject({ status: "precondition_failed", reason: "active_window_mismatch", actual: "0x999" });
  });

  it("checks focus after human approval and again at the dispatch boundary", async () => {
    const f = fixture(async () => { f.desktop.window = { ...f.desktop.window, id: "0x999" }; return "approved"; });
    const action = f.step({ key: "F4" }, "desktop_key_press");
    const result = await f.executor.execute(f.identity(), [action]);
    expect(result.status).toBe("precondition_failed");
    expect(f.sent).not.toHaveBeenCalled();
    const g = fixture();
    const second = g.step();
    second.run = async () => { g.desktop.window = { ...g.desktop.window, id: "0x888" }; return dispatchInput(g.sent); };
    expect(await g.executor.execute(g.identity(), [second])).toMatchObject({ status: "precondition_failed", reason: "active_window_mismatch" });
    expect(g.sent).not.toHaveBeenCalled();
  });

  it("revalidates a live accessible name, including after approval", async () => {
    const f = fixture(async () => { f.accessibility.elements = [accessibilityElement({ label: "Different button" })]; return "approved"; });
    const snapshot = await f.screenMap.observe({});
    const step = f.step({ snapshot_id: snapshot.snapshotId, element_id: 1, action_name: "click" }, "desktop_perform_element_action");
    expect(await f.executor.execute(f.identity(), [step])).toMatchObject({ status: "precondition_failed", reason: "element_name_mismatch", expected: "Save", actual: "Different button" });
    expect(f.sent).not.toHaveBeenCalled();
  });

  it("blocks high-impact actions without trusted approval despite confirmed=true", async () => {
    const f = fixture();
    expect(await f.executor.execute(f.identity(), [f.step({ key: "F4", confirmed: true }, "desktop_key_press")])).toMatchObject({ status: "approval_unavailable" });
    expect(f.sent).not.toHaveBeenCalled();
    const g = fixture(async () => "denied");
    expect(await g.executor.execute(g.identity(), [g.step({ key: "F4" }, "desktop_key_press")])).toMatchObject({ status: "approval_denied" });
  });

  it("classifies every validated target, so a benign condition cannot mask a destructive click", async () => {
    const f = fixture();
    f.accessibility.elements = [accessibilityElement(), accessibilityElement({ label: "Delete", x: 400, target: { backend: "fake", application: ":1.1", path: "/delete" } })];
    const snapshot = await f.screenMap.observe({});
    const benign = snapshot.elements.find((element) => element.label === "Save")!;
    const destructive = snapshot.elements.find((element) => element.label === "Delete")!;
    const step = f.step({ snapshot_id: snapshot.snapshotId, element_id: destructive.id, preconditions: { element: { snapshot_id: snapshot.snapshotId, element_id: benign.id } } }, "desktop_click_element");
    expect(await f.executor.execute(f.identity(), [step])).toMatchObject({ status: "approval_unavailable" });
    expect(f.sent).not.toHaveBeenCalled();
  });

  it("rejects conflicting explicit window conditions", async () => {
    const f = fixture();
    expect(await f.executor.execute(f.identity(), [f.step({ expected_window_id: "0x999", preconditions: { active_window_id: "0x123" } })])).toMatchObject({ status: "precondition_failed", reason: "active_window_condition_conflict" });
    expect(f.sent).not.toHaveBeenCalled();
  });

  it("coalesces simultaneous duplicates and retains completed results", async () => {
    const f = fixture();
    const steps = [f.step({ text: "hello" })];
    const [first, second] = await Promise.all([f.executor.execute(f.identity(), steps), f.executor.execute(f.identity(), steps)]);
    expect(first).toEqual(second);
    expect(first.status).toBe("dispatched");
    expect(await f.executor.execute(f.identity(), steps)).toEqual(first);
    expect(f.sent).toHaveBeenCalledOnce();
    expect(await f.executor.execute(f.identity(), [f.step({ text: "different" })])).toMatchObject({ status: "request_conflict" });
    expect(f.sent).toHaveBeenCalledOnce();
  });

  it("preserves completed prefixes when focus changes between batch steps", async () => {
    const f = fixture();
    const first = f.step();
    first.run = async () => { await dispatchInput(f.sent); f.desktop.window = { ...f.desktop.window, id: "0x777" }; return "sent"; };
    const result = await f.executor.execute(f.identity(), [first, f.step()]);
    expect(result).toMatchObject({ status: "precondition_failed", completed_steps: [0], failed_step: 1 });
    expect(f.sent).toHaveBeenCalledOnce();
    await f.executor.execute(f.identity(), [first, f.step({ expected_window_id: "0x123" })]);
    expect(f.sent).toHaveBeenCalledOnce();
  });

  it("retains uncertain outcomes, never retries, and requires a new observation", async () => {
    const f = fixture();
    f.sent.mockRejectedValue(new Error("response lost after send"));
    const steps = [f.step()];
    const result = await f.executor.execute(f.identity(), steps);
    expect(result.status).toBe("outcome_unknown");
    expect(await f.executor.execute(f.identity(), steps)).toEqual(result);
    expect(f.sent).toHaveBeenCalledOnce();
    expect(await f.executor.execute(f.identity("blocked"), steps)).toMatchObject({ status: "precondition_unknown", reason: "fresh_observation_required" });
    f.executor.markObserved(0);
    expect(await f.executor.execute(f.identity("old-observation"), steps)).toMatchObject({ reason: "fresh_observation_required" });
    f.executor.markObserved(f.executor.observationToken);
    f.sent.mockResolvedValue("accepted");
    expect((await f.executor.execute(f.identity("fresh"), steps)).status).toBe("dispatched");
  });

  it("treats a later check failure as uncertain when an earlier sub-event was sent", async () => {
    const f = fixture();
    const step = f.step();
    step.run = async () => {
      await dispatchInput(f.sent);
      f.desktop.window = { ...f.desktop.window, id: "0x666" };
      return dispatchInput(f.sent);
    };
    expect(await f.executor.execute(f.identity(), [step])).toMatchObject({ status: "outcome_unknown", completed_steps: [] });
    expect(f.sent).toHaveBeenCalledOnce();
  });

  it("blocks cancelled requests before dispatch and marks partial cancelled input uncertain", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    expect(await f.executor.execute(f.identity(), [f.step()], controller.signal)).toMatchObject({ reason: "request_cancelled", status: "precondition_unknown" });
    expect(f.sent).not.toHaveBeenCalled();
    const g = fixture();
    const active = new AbortController();
    const step = g.step();
    step.run = async () => { await dispatchInput(g.sent); active.abort(); return dispatchInput(g.sent); };
    expect(await g.executor.execute(g.identity(), [step], active.signal)).toMatchObject({ status: "outcome_unknown" });
    expect(g.sent).toHaveBeenCalledOnce();
  });

  it("does not evict replay protection at capacity and rejects old server sessions", async () => {
    const f = fixture(undefined, 1);
    await f.executor.execute(f.identity(), [f.step()]);
    expect(await f.executor.execute(f.identity("new"), [f.step()])).toMatchObject({ reason: "request_capacity_exhausted" });
    const next = fixture();
    expect(await next.executor.execute(f.identity(), [next.step()])).toMatchObject({ reason: "session_expired_or_invalid" });
    expect(next.sent).not.toHaveBeenCalled();
  });

  it("keeps observation failure separate from acknowledged dispatch", async () => {
    const f = fixture();
    f.sent.mockImplementation(async () => { vi.spyOn(f.desktop, "getActiveWindow").mockRejectedValue(new Error("observation unavailable")); return "accepted"; });
    const result = await f.executor.execute(f.identity(), [f.step()]);
    expect(result.status).toBe("dispatched");
    expect(result.observation).toMatchObject({ status: "unavailable" });
    expect(f.sent).toHaveBeenCalledOnce();
  });
});
