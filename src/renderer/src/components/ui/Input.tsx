import type { ComponentProps } from "react";

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return (
    <input
      className={`h-9 rounded-ezl border border-border bg-surface px-3 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none aria-[invalid=true]:border-danger ${className}`}
      {...props}
    />
  );
}
