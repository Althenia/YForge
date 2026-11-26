import type { HookOperation } from "../ipc/bindings/HookOperation";
import type { OptionalHook } from "../ipc/bindings/OptionalHook";
import { client } from "../ipc/client";
import { failureNotice } from "./errorNotice";
import { useQuery } from "./query";
import { repoKeys } from "./queryKeys";

export const SKIP_HOOKS_LABEL = "Skip optional hooks";
export const NO_OPTIONAL_HOOKS = "No hook is marked optional by repository or organization policy";
const CHECKING_HOOKS = "Checking which hooks policy marks optional…";

export const skipHooksNote = (hooks: readonly OptionalHook[]): string =>
  `Skips ${hooks.map((hook) => `${hook.name} (${hook.events.join(", ")})`).join(", ")}. Every other hook runs.`;

export const hookNames = (hooks: readonly OptionalHook[]): string[] => hooks.map((hook) => hook.name);

export function createOptionalHooks(path: () => string, operation: HookOperation) {
  const query = useQuery(() => ({ queryKey: repoKeys.read(path(), "optional-hooks", operation), queryFn: () => client.optionalHooks(path(), operation) }));
  const hooks = (): readonly OptionalHook[] => query.data ?? [];
  const reason = (): string | undefined => {
    if (query.error !== null) return failureNotice(query.error, "Optional hooks");
    if (query.isPending) return CHECKING_HOOKS;
    return hooks().length === 0 ? NO_OPTIONAL_HOOKS : undefined;
  };
  return { hooks, reason, key: () => hookNames(hooks()).join("\n") };
}
