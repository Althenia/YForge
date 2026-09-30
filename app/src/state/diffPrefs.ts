import { createStoreFields } from "./clientStore";
import type { DiffMode } from "./diffModel";

export function createDiffPrefs() {
  const field = createStoreFields<{ mode: DiffMode; ignoreWhitespace: boolean }>({ mode: "hunk", ignoreWhitespace: false });
  const [mode, setMode] = field("mode");
  const [ignoreWhitespace, setIgnoreWhitespace] = field("ignoreWhitespace");
  return { mode, setMode, ignoreWhitespace, setIgnoreWhitespace };
}

export type DiffPrefs = ReturnType<typeof createDiffPrefs>;
