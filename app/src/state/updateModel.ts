export function releaseNoteLines(notes: string): string[] {
  return notes
    .split("\n")
    .map((line) => line.trim().replace(/^(?:[-*•]|#{1,6})\s+/, "").trim())
    .filter((line) => line !== "");
}

export const updateFailureText = (message: string, version: string): string =>
  `${message.replace(/\.$/, "")}. You are on YForge ${version}; nothing was downloaded or changed.`;
