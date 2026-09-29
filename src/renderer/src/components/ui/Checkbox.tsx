import type { ReactNode } from "react";
import { Checkbox as RadixCheckbox } from "radix-ui";
import { Check } from "lucide-react";

export function Checkbox({
  checked,
  onChange,
  children,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-sm ${disabled ? "cursor-default opacity-60" : "cursor-pointer"}`}
    >
      <RadixCheckbox.Root
        checked={checked}
        disabled={disabled}
        onCheckedChange={(c) => {
          onChange(c === true);
        }}
        className="flex size-4 items-center justify-center rounded border border-border bg-surface data-[state=checked]:border-accent data-[state=checked]:bg-accent"
      >
        <RadixCheckbox.Indicator>
          <Check size={12} className="text-accent-contrast" />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      {children}
    </label>
  );
}
