import type { ConfirmCopy } from "../state/confirmCopy";
import { ConfirmDialog } from "./ConfirmDialog";

const initializeCopy = (folder: string): ConfirmCopy => ({
  title: "Initialize a Git repository?",
  lead: "This folder is not a Git repository.",
  names: [folder],
  consequences: ["Git starts tracking history here, on the default branch from Settings."],
  confirmLabel: "Initialize repository",
  neutral: true,
});

export function InitializeDialog(props: { folder: string; onConfirm: () => void; onCancel: () => void }) {
  return <ConfirmDialog copy={initializeCopy(props.folder)} onConfirm={props.onConfirm} onCancel={props.onCancel} />;
}
