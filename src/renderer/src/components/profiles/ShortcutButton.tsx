import { useTranslation } from "react-i18next";
import { MonitorUp } from "lucide-react";
import type { Profile } from "@shared/launcher";
import { errorMessage } from "../../lib/errors";
import { Button } from "../ui/Button";
import { useCreateShortcut } from "./useCreateShortcut";

/** The "Desktop shortcut" button of a profile page, with what it did. */
export function ShortcutButton({ profile }: { profile: Profile }) {
  const { t } = useTranslation();
  const { create, available } = useCreateShortcut();
  if (!available) return null;
  return (
    <span className="flex items-center gap-2">
      <Button
        variant="ghost"
        disabled={create.isPending}
        title={t("shortcut.hint")}
        onClick={() => {
          create.mutate(profile);
        }}
      >
        <MonitorUp size={16} aria-hidden />
        {t("shortcut.create")}
      </Button>
      {create.isSuccess && (
        <span role="status" className="text-xs text-success">
          {t("shortcut.created")}
        </span>
      )}
      {create.isError && (
        <span role="alert" className="text-xs text-danger">
          {errorMessage(t, create.error)}
        </span>
      )}
    </span>
  );
}
