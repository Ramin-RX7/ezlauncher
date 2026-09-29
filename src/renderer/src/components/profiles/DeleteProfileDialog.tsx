import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ProfileInfo } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { keys } from "../../state/queries";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { RadioGroup } from "../ui/RadioGroup";
import { Select } from "../ui/Select";

type Choice = "" | "delete" | "move";

/** Asks what to do with the profile's worlds; nothing is deleted without that choice. */
export function DeleteProfileDialog({
  profile,
  profiles,
  onClose,
  onDeleted,
}: {
  profile: ProfileInfo;
  profiles: ProfileInfo[];
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const worlds = useQuery({
    queryKey: keys.worlds(profile.id),
    queryFn: () => invoke("worlds:list", profile.id),
  });
  const others = profiles.filter((p) => p.id !== profile.id);
  const [choice, setChoice] = useState<Choice>("");
  const [target, setTarget] = useState(others[0]?.id ?? "");
  const worldCount = worlds.data?.length ?? 0;

  const remove = useMutation({
    mutationFn: () =>
      invoke("profiles:delete", {
        id: profile.id,
        worlds:
          worldCount > 0 && choice === "move" ? { moveTo: target } : "delete",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.profiles });
      void queryClient.invalidateQueries({ queryKey: ["worlds"] });
      onDeleted?.();
      onClose();
    },
  });

  const ready =
    worlds.isSuccess &&
    (worldCount === 0 ||
      choice === "delete" ||
      (choice === "move" && others.some((p) => p.id === target)));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("profiles.deleteDialog.title", { name: profile.name })}
      description={t("profiles.deleteDialog.body")}
      closeLabel={t("profiles.deleteDialog.cancel")}
      footer={
        <>
          <Button onClick={onClose}>{t("profiles.deleteDialog.cancel")}</Button>
          <Button
            variant="danger"
            disabled={!ready || remove.isPending}
            onClick={() => {
              remove.mutate();
            }}
          >
            {t("profiles.deleteDialog.confirm")}
          </Button>
        </>
      }
    >
      {worlds.isSuccess && worldCount === 0 && (
        <p className="text-sm text-muted">
          {t("profiles.deleteDialog.noWorlds")}
        </p>
      )}
      {worldCount > 0 && (
        <div className="flex flex-col gap-3">
          <span id="delete-worlds-choice" className="sr-only">
            {t("profiles.deleteDialog.body")}
          </span>
          <RadioGroup<Choice>
            value={choice}
            onChange={setChoice}
            labelledBy="delete-worlds-choice"
            options={[
              {
                value: "delete",
                label: t("profiles.deleteDialog.deleteWorlds", {
                  count: worldCount,
                }),
              },
              ...(others.length > 0
                ? [
                    {
                      value: "move" as const,
                      label: t("profiles.deleteDialog.moveWorlds"),
                    },
                  ]
                : []),
            ]}
          />
          {choice === "move" && (
            <Select
              aria-label={t("profiles.deleteDialog.moveTarget")}
              value={target}
              onChange={setTarget}
              options={others.map((p) => ({ value: p.id, label: p.name }))}
            />
          )}
        </div>
      )}
      {remove.isError && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {errorMessage(t, remove.error)}
        </p>
      )}
    </Dialog>
  );
}
