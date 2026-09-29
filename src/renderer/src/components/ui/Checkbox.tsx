import type { ReactNode } from "react";
import { Checkbox as RadixCheckbox } from "radix-ui";
import { Check } from "lucide-react";

export function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <RadixCheckbox.Root
        checked={checked}
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
