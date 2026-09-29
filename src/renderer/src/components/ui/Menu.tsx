import type { ReactNode } from "react";
import { ContextMenu, DropdownMenu } from "radix-ui";

export interface MenuItem {
  label: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

const CONTENT =
  "min-w-44 rounded-ezl border border-border bg-surface p-1 shadow-lg";
const itemClass = (item: MenuItem) =>
  `cursor-default rounded-ezl px-3 py-1.5 text-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2 ${item.danger ? "text-danger" : "text-text"}`;

/** A "…" button's menu. */
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
        <DropdownMenu.Content align="end" sideOffset={4} className={CONTENT}>
          {items.map((item, i) => (
            <DropdownMenu.Item
              key={i}
              disabled={item.disabled ?? false}
              onSelect={item.onSelect}
              className={itemClass(item)}
            >
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * The same menu on right-click, at the pointer. `children` is the row (one element,
 * rendered as-is), so a row and its "…" button offer the same items.
 */
export function ContextMenuArea({
  items,
  children,
}: {
  items: MenuItem[];
  children: ReactNode;
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={CONTENT}>
          {items.map((item, i) => (
            <ContextMenu.Item
              key={i}
              disabled={item.disabled ?? false}
              onSelect={item.onSelect}
              className={itemClass(item)}
            >
              {item.label}
            </ContextMenu.Item>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
