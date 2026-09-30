import { QueryClientProvider } from "@tanstack/solid-query";
import { RouterProvider } from "@tanstack/solid-router";
import { onCleanup, onMount } from "solid-js";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { createAppRouter } from "./routes";
import { AppContext, createAppState } from "./state/app";
import { installCrashCapture } from "./state/crashCapture";

export function App() {
  const router = createAppRouter();
  const app = createAppState(router);
  const view = () => router.state.location.pathname;
  onMount(() => onCleanup(installCrashCapture(view)));
  if (import.meta.env.DEV) void import("./devtools").then((devtools) => devtools.mountDevtools(app.queryClient, router));
  return (
    <AppErrorBoundary view={view}>
      <QueryClientProvider client={app.queryClient}>
        <AppContext.Provider value={app}>
          <RouterProvider router={router} />
        </AppContext.Provider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
