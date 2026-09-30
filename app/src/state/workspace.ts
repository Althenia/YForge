import type { AppInfo } from "../ipc/bindings/AppInfo";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { client, IpcError } from "../ipc/client";

export type WorkspaceView =
  | { status: "ready"; path: string; snapshot: RepoSnapshot; info: AppInfo }
  | { status: "not_a_repository"; path: string; message: string }
  | { status: "failed"; message: string };

export async function loadWorkspace(path: string): Promise<WorkspaceView> {
  try {
    const info = await client.appInfo();
    try {
      return { status: "ready", path, snapshot: await client.repoOpen(path), info };
    } catch (failure) {
      if (failure instanceof IpcError && failure.kind === "not_a_repository") {
        return { status: "not_a_repository", path, message: failure.message };
      }
      throw failure;
    }
  } catch (failure) {
    return { status: "failed", message: failure instanceof Error ? failure.message : String(failure) };
  }
}
