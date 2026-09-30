import { TanStackDevtools } from "@tanstack/solid-devtools";
import type { QueryClient } from "@tanstack/solid-query";
import { SolidQueryDevtoolsPanel } from "@tanstack/solid-query-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/solid-router-devtools";
import { render } from "solid-js/web";
import type { AppRouter } from "./routes";

export function mountDevtools(queryClient: QueryClient, router: AppRouter): void {
  const host = document.createElement("div");
  document.body.append(host);
  render(
    () => (
      <TanStackDevtools
        plugins={[
          { name: "TanStack Query", render: <SolidQueryDevtoolsPanel client={queryClient} /> },
          { name: "TanStack Router", render: <TanStackRouterDevtoolsPanel router={router} /> },
        ]}
      />
    ),
    host,
  );
}
