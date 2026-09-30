const labels = new Map<string, string>();

export const announceOperation = (id: string, label: string): void => {
  labels.set(id, label);
};

export const operationLabel = (id: string): string => labels.get(id) ?? "this operation";
