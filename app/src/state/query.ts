import {
  type DefaultError,
  type DefinedInitialDataInfiniteOptions,
  type DefinedInitialDataOptions,
  type DefinedUseInfiniteQueryResult,
  type DefinedUseQueryResult,
  type InfiniteData,
  InfiniteQueryObserver,
  type QueryClient,
  type QueryKey,
  QueryObserver,
  type UndefinedInitialDataInfiniteOptions,
  type UndefinedInitialDataOptions,
  type UseInfiniteQueryResult,
  type UseQueryResult,
  useQueryClient,
} from "@tanstack/solid-query";
import { type Accessor, createComputed, createSignal, on, onCleanup, untrack } from "solid-js";

type Observed<Options, Result> = {
  setOptions: (options: Options) => void;
  getOptimisticResult: (options: Options) => Result;
  subscribe: (listener: (result: Result) => void) => () => void;
};

function observe<Options, Result extends object>(
  options: Accessor<Options>,
  queryClient: Accessor<QueryClient> | undefined,
  create: (client: QueryClient, options: Options) => Observed<Options, Result>,
): Result {
  const client = queryClient?.() ?? useQueryClient();
  const defaulted = () => client.defaultQueryOptions(options() as never) as Options;
  const initial = untrack(defaulted);
  const observer = create(client, initial);
  const [result, setResult] = createSignal(observer.getOptimisticResult(initial), { equals: false });
  createComputed(
    on(
      defaulted,
      (next) => {
        observer.setOptions(next);
        setResult(() => observer.getOptimisticResult(next));
      },
      { defer: true },
    ),
  );
  onCleanup(observer.subscribe((next) => setResult(() => next)));
  return new Proxy({} as Result, { get: (_, property) => result()[property as keyof Result] });
}

export function useQuery<TQueryFnData = unknown, TError = DefaultError, TData = TQueryFnData, TQueryKey extends QueryKey = QueryKey>(
  options: UndefinedInitialDataOptions<TQueryFnData, TError, TData, TQueryKey>,
  queryClient?: Accessor<QueryClient>,
): UseQueryResult<TData, TError>;
export function useQuery<TQueryFnData = unknown, TError = DefaultError, TData = TQueryFnData, TQueryKey extends QueryKey = QueryKey>(
  options: DefinedInitialDataOptions<TQueryFnData, TError, TData, TQueryKey>,
  queryClient?: Accessor<QueryClient>,
): DefinedUseQueryResult<TData, TError>;
export function useQuery(options: Accessor<object>, queryClient?: Accessor<QueryClient>): unknown {
  return observe(options, queryClient, (client, initial) => new QueryObserver(client, initial as never) as unknown as Observed<object, object>);
}

export function useInfiniteQuery<TQueryFnData, TError = DefaultError, TData = InfiniteData<TQueryFnData>, TQueryKey extends QueryKey = QueryKey, TPageParam = unknown>(
  options: UndefinedInitialDataInfiniteOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam>,
  queryClient?: Accessor<QueryClient>,
): UseInfiniteQueryResult<TData, TError>;
export function useInfiniteQuery<TQueryFnData, TError = DefaultError, TData = InfiniteData<TQueryFnData>, TQueryKey extends QueryKey = QueryKey, TPageParam = unknown>(
  options: DefinedInitialDataInfiniteOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam>,
  queryClient?: Accessor<QueryClient>,
): DefinedUseInfiniteQueryResult<TData, TError>;
export function useInfiniteQuery(options: Accessor<object>, queryClient?: Accessor<QueryClient>): unknown {
  return observe(options, queryClient, (client, initial) => new InfiniteQueryObserver(client, initial as never) as unknown as Observed<object, object>);
}
