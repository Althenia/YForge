import { client } from "../ipc/client";
import { aiKeys } from "./queryKeys";

export const providersOptions = () => ({ queryKey: aiKeys.providers, queryFn: () => client.aiProvidersList() });

export const modelsOptions = (id: string) => ({ queryKey: aiKeys.models(id), queryFn: () => client.aiProviderModels(id), enabled: false, staleTime: Infinity, retry: false });
