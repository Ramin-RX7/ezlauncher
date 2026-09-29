import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Profile, ProfileInfo } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Dialog } from "../ui/Dialog";

/** Duplicate a profile: settings and mods always; its worlds only when ticked. */
export function DuplicateProfileDialog({
  profile,
  onClose,
  onDuplicated,
}: {
  profile: ProfileInfo;
  onClose: () => void;
  onDuplicated: (copy: Profile) => void;
}) {
  const { t } = useTranslation();
  const [copyWorlds, setCopyWorlds] = useState(false);
  const worlds = useQuery({
    queryKey: ["worlds", profile.id],
    queryFn: () => invoke("worlds:list", profile.id),
  });
  const count = worlds.data?.length ?? 0;
  const running = profile.running > 0;

  const duplicate = useMutation({
    mutationFn: () =>
      invoke("profiles:duplicate", profile.id, {
        copyWorlds: copyWorlds && count > 0,
      }),
    onSuccess: (copy) => {
      onDuplicated(copy);
      onClose();
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !duplicate.isPending) onClose();
      }}
      title={t("profiles.duplicateDialog.title", { name: profile.name })}
      description={t("profiles.duplicateDialog.body")}
      closeLabel={t("profiles.duplicateDialog.cancel")}
      footer={
        <>
          <Button disabled={duplicate.isPending} onClick={onClose}>
            {t("profiles.duplicateDialog.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={duplicate.isPending || (copyWorlds && running)}
            onClick={() => {
              duplicate.mutate();
            }}
          >
            {duplicate.isPending
              ? t("profiles.duplicateDialog.working")
              : t("profiles.duplicateDialog.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-sm">
        <Checkbox
          checked={copyWorlds}
          disabled={count === 0}
          onChange={setCopyWorlds}
        >
          {count > 0
            ? t("profiles.duplicateDialog.copyWorlds", { count })
            : t("profiles.duplicateDialog.noWorlds")}
        </Checkbox>
        {copyWorlds && (
          <p className="text-xs text-muted">
            {t("profiles.duplicateDialog.copyHint")}
          </p>
        )}
        {copyWorlds && running && (
          <p className="text-xs text-warning">
            {t("profiles.duplicateDialog.running")}
          </p>
        )}
        {duplicate.isError && (
          <p role="alert" className="text-danger">
            {errorMessage(t, duplicate.error)}
          </p>
        )}
      </div>
    </Dialog>
  );
}
