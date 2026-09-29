import type { ReactNode } from "react";
import { Tabs as RadixTabs } from "radix-ui";

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
}

/** A row of tabs that only switches a value (the content is rendered by the caller). */
export function TabBar<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <RadixTabs.Root
      value={value}
      onValueChange={(v) => {
        onChange(v as T);
      }}
    >
      <RadixTabs.List
        aria-label={label}
        className="flex gap-1 border-b border-border"
      >
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted hover:text-text data-[state=active]:border-accent data-[state=active]:text-text"
          >
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
    </RadixTabs.Root>
  );
}
