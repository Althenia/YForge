import { createHashHistory, createRootRoute, createRoute, createRouter, type RouterHistory } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { Launchpad } from "./components/Launchpad";
import { SettingsView } from "./components/SettingsView";
import { TabBar } from "./components/TabBar";
import { RepositoryTab } from "./RepositoryTab";
import { Shell } from "./Shell";

const rootRoute = createRootRoute({ component: Shell });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/" });

const launcherRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/launcher",
  component: () => (
    <div class="app launchpad-app">
      <TabBar />
      <Launchpad />
    </div>
  ),
});

const launchpadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/launchpad",
  validateSearch: (search: Record<string, unknown>): { tab?: string } => (typeof search.tab === "string" ? { tab: search.tab } : {}),
  component: () => (
    <div class="app launchpad-app">
      <TabBar />
      <Launchpad />
    </div>
  ),
});

const repoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/repo",
  validateSearch: (search: Record<string, unknown>) => ({ tab: typeof search.tab === "string" ? search.tab : "" }),
  component: () => {
    const search = repoRoute.useSearch();
    return (
      <Show when={search().tab} keyed>
        {(path) => <RepositoryTab path={path} />}
      </Show>
    );
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/$section",
  validateSearch: (search: Record<string, unknown>): { tab?: string } => (typeof search.tab === "string" ? { tab: search.tab } : {}),
  component: () => {
    const params = settingsRoute.useParams();
    return (
      <div class="app settings-app">
        <TabBar />
        <SettingsView section={params().section} />
      </div>
    );
  },
});

export function createAppRouter(history: RouterHistory = createHashHistory()) {
  return createRouter({ routeTree: rootRoute.addChildren([indexRoute, launcherRoute, launchpadRoute, repoRoute, settingsRoute]), history });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/solid-router" {
  interface Register {
    router: AppRouter;
  }
}

export type View =
  | { kind: "none" }
  | { kind: "launcher" }
  | { kind: "launchpad"; tab: string | undefined }
  | { kind: "repo"; tab: string }
  | { kind: "settings"; section: string; tab: string | undefined };

type Match = { routeId: string; params: Record<string, string>; search: Record<string, unknown> };

export function viewOf(matches: readonly Match[]): View {
  const match = matches.at(-1);
  if (match?.routeId === launcherRoute.id) return { kind: "launcher" };
  if (match?.routeId === launchpadRoute.id) {
    const tab = match.search.tab;
    return { kind: "launchpad", tab: typeof tab === "string" ? tab : undefined };
  }
  if (match?.routeId === repoRoute.id) return { kind: "repo", tab: String(match.search.tab ?? "") };
  if (match?.routeId === settingsRoute.id) {
    const tab = match.search.tab;
    return { kind: "settings", section: String(match.params.section), tab: typeof tab === "string" ? tab : undefined };
  }
  return { kind: "none" };
}
