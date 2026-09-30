import { QueryClientProvider } from "@tanstack/solid-query";
import { RouterProvider } from "@tanstack/solid-router";
import { createAppRouter } from "./routes";
import { AppContext, createAppState } from "./state/app";

export function App() {
  const router = createAppRouter();
  const app = createAppState(router);
  if (import.meta.env.DEV) void import("./devtools").then((devtools) => devtools.mountDevtools(app.queryClient, router));
  return (
    <QueryClientProvider client={app.queryClient}>
      <AppContext.Provider value={app}>
        <RouterProvider router={router} />
      </AppContext.Provider>
    </QueryClientProvider>
  );
}
