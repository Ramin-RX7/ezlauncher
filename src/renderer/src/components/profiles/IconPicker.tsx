import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Popover } from "radix-ui";
import { Box, ChevronDown } from "lucide-react";
import { ProfileIcon } from "./ProfileIcon";
import { PROFILE_ICONS } from "./profileIcons";

/** The profile's icon as a small button; the full grid opens in a dropdown. */
export function IconPicker({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (iconId: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const pick = (id: string | undefined) => {
    onChange(id);
    setOpen(false);
  };
  const cell = (selected: boolean) =>
    `flex size-9 items-center justify-center overflow-hidden rounded-ezl border bg-surface-2 hover:opacity-80 ${selected ? "border-accent" : "border-transparent"}`;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t("profiles.editor.icon")}
          className="flex h-9 items-center gap-1.5 rounded-ezl border border-border bg-surface px-1 hover:border-muted"
        >
          <ProfileIcon iconId={value} small />
          <ChevronDown size={14} className="text-muted" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          aria-label={t("profiles.editor.icon")}
          className="grid w-[21rem] grid-cols-8 gap-1.5 rounded-ezl border border-border bg-surface p-2 shadow-lg"
        >
          <button
            type="button"
            aria-pressed={value === undefined}
            aria-label={t("profiles.editor.noIcon")}
            title={t("profiles.editor.noIcon")}
            onClick={() => {
              pick(undefined);
            }}
            className={cell(value === undefined)}
          >
            <Box size={18} className="text-muted" aria-hidden />
          </button>
          {PROFILE_ICONS.map((ic) => (
            <button
              key={ic.id}
              type="button"
              aria-pressed={value === ic.id}
              aria-label={ic.id}
              title={ic.id}
              onClick={() => {
                pick(ic.id);
              }}
              className={cell(value === ic.id)}
            >
              <img
                src={ic.url}
                alt=""
                className="size-full [image-rendering:pixelated]"
              />
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
