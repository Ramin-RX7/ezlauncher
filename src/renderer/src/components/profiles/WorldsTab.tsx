import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FolderOpen, TriangleAlert } from "lucide-react";
import type { ProfileInfo, WorldInfo } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { keys, useProfiles, useVersionList } from "../../state/queries";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Select } from "../ui/Select";
import { isRiskyMove } from "./moveRisk";

/** A profile's worlds, with Open folder and Move to another profile. */
export function WorldsTab({ profile }: { profile: ProfileInfo }) {
  const { t, i18n } = useTranslation();
  const worlds = useQuery({
    queryKey: keys.worlds(profile.id),
    queryFn: () => invoke("worlds:list", profile.id),
  });
  const [moving, setMoving] = useState<WorldInfo>();
  const [error, setError] = useState<string>();
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [i18n.language],
  );

  if (worlds.isPending) return null;
  const list = worlds.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {list.length === 0 ? (
        <p className="rounded-ezl border border-border bg-surface p-6 text-center text-sm text-muted">
          {t("worlds.empty")}
        </p>
      ) : (
        <ul className="overflow-hidden rounded-ezl border border-border bg-surface">
          {list.map((w) => (
            <li
              key={w.id}
              className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{w.name}</span>
                <span className="text-xs text-muted">
                  {w.lastPlayed &&
                    t("worlds.lastPlayed", {
                      date: dateFormat.format(new Date(w.lastPlayed)),
                    })}
                </span>
                {!w.linked && (
                  <span className="mt-1 flex items-center gap-1 text-xs text-warning">
                    <TriangleAlert size={14} aria-hidden />
                    {t("worlds.notLinked")}
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  setError(undefined);
                  invoke("worlds:openFolder", {
                    profileId: profile.id,
                    worldId: w.id,
                  }).catch((err: unknown) => {
                    setError(errorMessage(t, err));
                  });
                }}
              >
                <FolderOpen size={16} aria-hidden />
                {t("worlds.openFolder")}
              </Button>
              <Button
                disabled={!w.linked || profile.running > 0}
                title={
                  profile.running > 0 ? t("worlds.runningBlocked") : undefined
                }
                onClick={() => {
                  setMoving(w);
                }}
              >
                {t("worlds.move")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {moving && (
        <MoveWorldDialog
          world={moving}
          from={profile}
          onClose={() => {
            setMoving(undefined);
          }}
        />
      )}
    </div>
  );
}

/** Pick a profile to move a world to, or to give an unassigned world to. */
export function MoveWorldDialog({
  world,
  from,
  onClose,
}: {
  world: { id: string; name: string };
  /** The current owner; undefined for unassigned worlds. */
  from?: ProfileInfo;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const profiles = useProfiles();
  const versions = useVersionList();
  const targets = (profiles.data ?? []).filter(
    (p) => p.id !== from?.id && p.running === 0,
  );
  const [target, setTarget] = useState(targets[0]?.id ?? "");
  const to = targets.find((p) => p.id === target);
  const risky =
    to !== undefined && isRiskyMove(from, to, versions.data?.versions ?? []);

  const move = useMutation({
    mutationFn: () =>
      invoke("worlds:move", { worldId: world.id, toProfileId: target }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["worlds"] });
      onClose();
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("worlds.moveTitle", { name: world.name })}
      description={t("worlds.moveBody")}
      closeLabel={t("worlds.cancel")}
      footer={
        <>
          <Button onClick={onClose}>{t("worlds.cancel")}</Button>
          <Button
            variant="primary"
            disabled={!to || move.isPending}
            onClick={() => {
              move.mutate();
            }}
          >
            {from ? t("worlds.moveConfirm") : t("worlds.assignConfirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Select
          aria-label={t("worlds.moveTarget")}
          value={target}
          onChange={setTarget}
          options={targets.map((p) => ({ value: p.id, label: p.name }))}
        />
        {risky && (
          <p role="alert" className="text-sm text-warning">
            {t("worlds.olderWarning")} {t("profiles.changeWarning.body")}
          </p>
        )}
        {move.isError && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(t, move.error)}
          </p>
        )}
      </div>
    </Dialog>
  );
}
