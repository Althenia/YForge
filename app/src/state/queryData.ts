type Reading<T> = { status: "pending" | "error" | "success"; data: T | undefined };

export const dataOf = <T>(query: Reading<T>): T | undefined => (query.status === "pending" ? undefined : query.data);
