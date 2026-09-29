import type { ReactNode } from "react";
import { RadioGroup as RadixRadio } from "radix-ui";

export function RadioGroup<T extends string>({
  value,
  onChange,
  options,
  labelledBy,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: ReactNode }[];
  labelledBy: string;
}) {
  return (
    <RadixRadio.Root
      value={value}
      onValueChange={(v) => {
        onChange(v as T);
      }}
      aria-labelledby={labelledBy}
      className="flex flex-col gap-2"
    >
      {options.map((o) => (
        <label
          key={o.value}
          className="flex cursor-pointer items-center gap-2 text-sm"
        >
          <RadixRadio.Item
            value={o.value}
            className="flex size-4 items-center justify-center rounded-full border border-border bg-surface data-[state=checked]:border-accent"
          >
            <RadixRadio.Indicator className="size-2 rounded-full bg-accent" />
          </RadixRadio.Item>
          {o.label}
        </label>
      ))}
    </RadixRadio.Root>
  );
}
