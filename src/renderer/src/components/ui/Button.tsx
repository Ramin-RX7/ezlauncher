import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-contrast hover:bg-accent-hover",
  secondary: "bg-surface-2 text-text border border-border hover:border-muted",
  ghost: "bg-transparent text-text hover:bg-surface-2",
  danger: "bg-danger text-accent-contrast hover:opacity-90",
};

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: Variant;
}

export function Button({
  variant = "secondary",
  className = "",
  type,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={`inline-flex items-center justify-center gap-2 rounded-ezl px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
