import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { DataPackWorld, LibraryPack } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Dialog } from "../ui/Dialog";

/** Put one library data pack into several worlds at once, picked by profile. */
export function AddToWorldsDialog({
  pack,
  onClose,
}: {
  pack: LibraryPack;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const worlds = useQuery({
    queryKey: ["dataPacks", "worlds", pack.sha1],
    queryFn: () => invoke("dataPacks:worlds", pack.sha1),
  });
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const add = useMutation({
    mutationFn: () =>
      invoke("dataPacks:addToWorlds", {
        sha1: pack.sha1,
        worldIds: [...picked],
      }),
    onSuccess: (result) => {
      setPicked(new Set());
      void queryClient.invalidateQueries({ queryKey: ["dataPacks"] });
      if (result.failed.length === 0) onClose();
    },
  });

  const byProfile = useMemo(() => {
    const groups = new Map<string, DataPackWorld[]>();
    for (const w of worlds.data ?? [])
      groups.set(w.profileName, [...(groups.get(w.profileName) ?? []), w]);
    return [...groups];
  }, [worlds.data]);
  const nameOf = (worldId: string) =>
    worlds.data?.find((w) => w.worldId === worldId)?.name ?? worldId;
  const failed = add.data?.failed ?? [];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("dataPacks.toWorlds.title", { name: pack.name })}
      description={t("dataPacks.toWorlds.hint")}
      closeLabel={t("dataPacks.cancel")}
      footer={
        <>
          <Button onClick={onClose}>{t("dataPacks.cancel")}</Button>
          <Button
            variant="primary"
            disabled={picked.size === 0 || add.isPending}
            onClick={() => {
              add.mutate();
            }}
          >
            {t("dataPacks.toWorlds.confirm", { count: picked.size })}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[50vh] flex-col gap-3 overflow-auto">
        {worlds.isSuccess && byProfile.length === 0 && (
          <p className="text-sm text-muted">{t("dataPacks.toWorlds.none")}</p>
        )}
        {byProfile.map(([profileName, list]) => (
          <fieldset key={profileName} className="flex flex-col gap-1">
            <legend className="mb-1 text-xs font-semibold text-muted">
              {profileName}
            </legend>
            {list.map((w) => {
              const blocked = w.hasPack || w.busy || w.unsupported;
              return (
                <Checkbox
                  key={w.worldId}
                  checked={w.hasPack || picked.has(w.worldId)}
                  disabled={blocked}
                  onChange={(on) => {
                    setPicked((current) => {
                      const next = new Set(current);
                      if (on) next.add(w.worldId);
                      else next.delete(w.worldId);
                      return next;
                    });
                  }}
                >
                  <span>{w.name}</span>
                  {(w.hasPack || w.busy || w.unsupported) && (
                    <span className="text-xs text-muted">
                      {w.hasPack
                        ? t("dataPacks.toWorlds.has")
                        : w.busy
                          ? t("dataPacks.toWorlds.busy")
                          : t("dataPacks.toWorlds.unsupported")}
                    </span>
                  )}
                </Checkbox>
              );
            })}
          </fieldset>
        ))}
        {worlds.isError && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(t, worlds.error)}
          </p>
        )}
        {add.isError && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(t, add.error)}
          </p>
        )}
        {failed.length > 0 && (
          <p role="alert" className="text-sm text-warning">
            {t("dataPacks.toWorlds.failed", {
              worlds: failed
                .map((f) => `${nameOf(f.worldId)} (${errorMessage(t, f)})`)
                .join(", "),
            })}
          </p>
        )}
      </div>
    </Dialog>
  );
}
