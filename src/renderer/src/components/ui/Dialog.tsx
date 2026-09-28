import type { ReactNode } from "react";
import { Dialog as RadixDialog } from "radix-ui";
import { X } from "lucide-react";

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element that opens the dialog; rendered as-is (`asChild`). */
  trigger?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  closeLabel: string;
  children?: ReactNode;
  footer?: ReactNode;
}

export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  closeLabel,
  children,
  footer,
}: DialogProps) {
  const rootProps = {
    ...(open !== undefined && { open }),
    ...(onOpenChange && { onOpenChange }),
  };
  return (
    <RadixDialog.Root {...rootProps}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 bg-overlay" />
        <RadixDialog.Content className="fixed inset-0 m-auto h-fit w-[min(90vw,28rem)] rounded-ezl border border-border bg-surface p-6 shadow-xl">
          <div className="flex items-start justify-between gap-4">
            <RadixDialog.Title className="text-lg font-semibold">
              {title}
            </RadixDialog.Title>
            <RadixDialog.Close
              aria-label={closeLabel}
              className="rounded-ezl p-1 text-muted hover:bg-surface-2 hover:text-text"
            >
              <X size={18} />
            </RadixDialog.Close>
          </div>
          {description ? (
            <RadixDialog.Description className="mt-1 text-sm text-muted">
              {description}
            </RadixDialog.Description>
          ) : (
            <RadixDialog.Description className="sr-only">
              {title}
            </RadixDialog.Description>
          )}
          {children && <div className="mt-4">{children}</div>}
          {footer && (
            <div className="mt-6 flex justify-end gap-2">{footer}</div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
