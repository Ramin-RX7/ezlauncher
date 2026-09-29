import type { ReactNode } from "react";
import { DropdownMenu } from "radix-ui";

export interface MenuItem {
  label: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function Menu({
  trigger,
  items,
}: {
  trigger: ReactNode;
  items: MenuItem[];
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="min-w-44 rounded-ezl border border-border bg-surface p-1 shadow-lg"
        >
          {items.map((item, i) => (
            <DropdownMenu.Item
              key={i}
              disabled={item.disabled ?? false}
              onSelect={item.onSelect}
              className={`cursor-default rounded-ezl px-3 py-1.5 text-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2 ${item.danger ? "text-danger" : "text-text"}`}
            >
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
