import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { keys } from "../../state/queries";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

/**
 * After a profile's version or loader changed: offer to fetch its mods again for the
 * new target. Mounted while open, so each time starts fresh.
 */
export function ApplyModsDialog({
  profileId,
  onClose,
}: {
  profileId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const applyMods = useMutation({
    mutationFn: (id: string) => invoke("mods:applyForProfile", id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mods"] });
      void queryClient.invalidateQueries({ queryKey: keys.profiles });
    },
  });
  const result = applyMods.data;

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !applyMods.isPending) onClose();
      }}
      title={t("profiles.applyMods.title")}
      closeLabel={t("profiles.applyMods.close")}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            {t("profiles.applyMods.close")}
          </Button>
        ) : (
          <>
            <Button disabled={applyMods.isPending} onClick={onClose}>
              {t("profiles.applyMods.skip")}
            </Button>
            <Button
              variant="primary"
              disabled={applyMods.isPending}
              onClick={() => {
                applyMods.mutate(profileId);
              }}
            >
              {t("profiles.applyMods.update")}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            {t("profiles.applyMods.downloaded", { count: result.downloaded })}
          </p>
          {result.disabled.length > 0 && (
            <p className="text-warning">
              {t("profiles.applyMods.disabled", {
                count: result.disabled.length,
                names: result.disabled.map((d) => d.name).join(", "),
              })}
            </p>
          )}
          {result.unresolved.length > 0 && (
            <p className="text-muted">
              {t("profiles.applyMods.unresolved", {
                count: result.unresolved.length,
                names: result.unresolved.map((d) => d.name).join(", "),
              })}
            </p>
          )}
        </div>
      ) : applyMods.isError ? (
        <p className="text-sm text-danger">
          {errorMessage(t, applyMods.error)}
        </p>
      ) : (
        <p className="text-sm text-muted">
          {applyMods.isPending
            ? t("profiles.applyMods.working")
            : t("profiles.applyMods.body")}
        </p>
      )}
    </Dialog>
  );
}
