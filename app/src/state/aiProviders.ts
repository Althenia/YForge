import type { QueryClient } from "@tanstack/solid-query";
import { client } from "../ipc/client";
import { aiKeys } from "./queryKeys";

export const refreshProviders = (queryClient: QueryClient, providerId?: string) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: aiKeys.providers }),
    queryClient.invalidateQueries({ queryKey: aiKeys.features }),
    queryClient.invalidateQueries(providerId ? { queryKey: aiKeys.models(providerId) } : { queryKey: ["ai", "models"] }),
  ]);

export const providersOptions = () => ({ queryKey: aiKeys.providers, queryFn: () => client.aiProvidersList() });

export const modelsOptions = (id: string) => ({ queryKey: aiKeys.models(id), queryFn: () => client.aiProviderModels(id), enabled: id !== "", staleTime: Infinity, retry: false });
