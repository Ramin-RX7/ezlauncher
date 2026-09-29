import type { ComponentProps } from "react";
import { ChevronDown } from "lucide-react";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string> extends Omit<
  ComponentProps<"select">,
  "value" | "onChange"
> {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
}

/** A native select (keyboard, screen readers and disabled options for free), themed. */
export function Select<T extends string>({
  value,
  options,
  onChange,
  className = "",
  ...props
}: SelectProps<T>) {
  return (
    <span className={`relative inline-flex ${className}`}>
      <select
        value={value}
        onChange={(e) => {
          onChange(e.target.value as T);
        }}
        className="h-9 w-full appearance-none rounded-ezl border border-border bg-surface ps-3 pe-8 text-sm text-text focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled ?? false}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={16}
        aria-hidden
        className="pointer-events-none absolute end-2.5 top-2.5 text-muted"
      />
    </span>
  );
}
