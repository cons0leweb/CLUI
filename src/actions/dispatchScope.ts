import { AsyncLocalStorage } from "node:async_hooks";
export interface DispatchScope { attempted: boolean; validate(): Promise<void>; assertActive?(): void }
const scope = new AsyncLocalStorage<DispatchScope>();
export function withDispatchScope<T>(state: DispatchScope, operation: () => Promise<T>): Promise<T> { return scope.run(state, operation); }
export async function dispatchInput<T>(operation: () => Promise<T>, prepare?: () => Promise<void>): Promise<T> {
  const state = scope.getStore();
  if (state) {
    await state.validate();
  }
  await prepare?.();
  state?.assertActive?.();
  if (state) {
    // After this boundary, failures must be treated as potentially applied input.
    state.attempted = true;
  }
  return operation();
}
