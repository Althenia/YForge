
export function branchNameProblem(name: string, existing: readonly string[], unchanged?: string): string | undefined {
  if (name === "") return undefined;
  if (name === unchanged) return "Enter a different name";
  if (existing.includes(name)) return `A branch named ${name} already exists`;
  return undefined;
}
