import { Progress as RadixProgress } from "radix-ui";

/** `value` from 0 to 100; undefined shows an indeterminate bar. */
export function Progress({ value, label }: { value?: number; label: string }) {
  return (
    <RadixProgress.Root
      value={value ?? null}
      aria-label={label}
      className="relative h-2 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <RadixProgress.Indicator
        className={`h-full bg-accent transition-[width] duration-200 ${value === undefined ? "w-1/3 animate-pulse" : ""}`}
        style={
          value === undefined
            ? undefined
            : { width: `${Math.min(100, Math.max(0, value))}%` }
        }
      />
    </RadixProgress.Root>
  );
}
