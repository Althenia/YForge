import { createSignal } from "solid-js";
import { client } from "../ipc/client";

export function branchNameProblem(name: string, existing: readonly string[], unchanged?: string): string | undefined {
  if (name === "") return undefined;
  if (name === unchanged) return "Enter a different name";
  if (existing.includes(name)) return `A branch named ${name} already exists`;
  return undefined;
}

export function createBranchNameField(path: string, existing: readonly string[], initial = "", unchanged?: string) {
  const [value, setRaw] = createSignal(initial);
  const [remoteProblem, setRemoteProblem] = createSignal<string | undefined>();
  const [checkedName, setCheckedName] = createSignal<string | undefined>();
  let latest = 0;

  const localProblem = () => branchNameProblem(value(), existing, unchanged);
  const problem = () => localProblem() ?? (checkedName() === value() ? remoteProblem() : undefined);
  const valid = () => value() !== "" && localProblem() === undefined && checkedName() === value() && remoteProblem() === undefined;

  async function check(name: string): Promise<void> {
    const ticket = ++latest;
    if (name === "" || branchNameProblem(name, existing, unchanged) !== undefined) return;
    let failure: string | undefined;
    try {
      await client.checkBranchName(path, name);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (ticket !== latest) return;
    setRemoteProblem(failure === undefined ? undefined : `${name} is not a valid branch name`);
    setCheckedName(name);
  }

  function setValue(name: string): Promise<void> {
    setRaw(name);
    return check(name);
  }

  return { value, setValue, problem, valid };
}

export type BranchNameField = ReturnType<typeof createBranchNameField>;
