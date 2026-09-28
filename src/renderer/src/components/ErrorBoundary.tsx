import { Component, type ErrorInfo, type ReactNode } from "react";
import i18n from "../i18n";
import { Button } from "./ui/Button";

interface State {
  error: Error | null;
}

/** Last-resort error screen, so a render bug never leaves a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Render error", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-4 p-8"
      >
        <h1 className="text-xl font-semibold">{i18n.t("error.title")}</h1>
        <pre className="max-w-full overflow-auto rounded-ezl bg-surface-2 p-3 text-xs text-muted">
          {this.state.error.message}
        </pre>
        <Button
          variant="primary"
          onClick={() => {
            window.location.reload();
          }}
        >
          {i18n.t("error.reload")}
        </Button>
      </div>
    );
  }
}
