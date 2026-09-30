import { ErrorBoundary, type JSX } from "solid-js";
import { reportCrash } from "../state/crashCapture";
import { EmptyState } from "./EmptyState";

export function AppErrorBoundary(props: { view: () => string; children: JSX.Element }) {
  return (
    <ErrorBoundary
      fallback={(failure) => {
        reportCrash("render", failure, props.view());
        return <EmptyState title="YForge hit an unexpected error" message={failure instanceof Error ? failure.message : String(failure)} danger />;
      }}
    >
      {props.children}
    </ErrorBoundary>
  );
}
