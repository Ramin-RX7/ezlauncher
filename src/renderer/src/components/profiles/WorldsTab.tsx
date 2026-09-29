import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Archive, FolderOpen, TriangleAlert } from "lucide-react";
import type { BackupResult, ProfileInfo, WorldInfo } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { relativeTime } from "../../lib/relativeTime";
import { keys, useProfiles, useVersionList } from "../../state/queries";
import { BackupsDialog } from "../backups/BackupsDialog";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { ContextMenuArea, type MenuItem } from "../ui/Menu";
import { Select } from "../ui/Select";
import { isRiskyMove } from "./moveRisk";

/** A profile's worlds, with backups, Open folder and Move to another profile. */
export function WorldsTab({ profile }: { profile: ProfileInfo }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const worlds = useQuery({
    queryKey: keys.worlds(profile.id),
    queryFn: () => invoke("worlds:list", profile.id),
  });
  const [moving, setMoving] = useState<WorldInfo>();
  const [browsing, setBrowsing] = useState<WorldInfo>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [i18n.language],
  );
  const running = profile.running > 0;

  /** What a backup job did, in one line. */
  const describe = (r: BackupResult) =>
    [
      r.created.length > 0 && t("backups.created", { count: r.created.length }),
      r.unchanged.length > 0 &&
        t("backups.unchanged", { names: r.unchanged.join(", ") }),
      r.failed.length > 0 &&
        t("backups.failed", { names: r.failed.map((x) => x.name).join(", ") }),
    ]
      .filter(Boolean)
      .join(" ");

  const backUp = useMutation({
    mutationFn: (worldIds?: string[]) =>
      invoke("backups:create", {
        profileId: profile.id,
        ...(worldIds && { worldIds }),
      }),
    onMutate: () => {
      setError(undefined);
      setNotice(undefined);
    },
    onSuccess: (result) => {
      setNotice(describe(result));
      void queryClient.invalidateQueries({ queryKey: ["worlds"] });
    },
    onError: (err) => {
      setError(errorMessage(t, err));
    },
  });

  if (worlds.isPending) return null;
  const list = worlds.data ?? [];
  // A restored world keeps its in-game name: show folders when names repeat.
  const repeated = new Set(
    list.map((w) => w.name).filter((name, i, all) => all.indexOf(name) !== i),
  );

  const openFolder = (w: WorldInfo) => {
    setError(undefined);
    invoke("worlds:openFolder", {
      profileId: profile.id,
      worldId: w.id,
    }).catch((err: unknown) => {
      setError(errorMessage(t, err));
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {list.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {running && (
            <span className="me-auto text-xs text-muted">
              {t("backups.runningBlocked")}
            </span>
          )}
          <Button
            disabled={running || backUp.isPending}
            onClick={() => {
              backUp.mutate(undefined);
            }}
          >
            <Archive size={16} aria-hidden />
            {t("backups.backUpAll")}
          </Button>
        </div>
      )}
      {notice && (
        <p className="text-sm text-muted" aria-live="polite">
          {notice}
        </p>
      )}
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
          {list.map((w) => {
            const items: MenuItem[] = [
              {
                label: t("backups.backUp"),
                disabled: running || backUp.isPending,
                onSelect: () => {
                  backUp.mutate([w.id]);
                },
              },
              {
                label: t("backups.list", { count: w.backupCount ?? 0 }),
                onSelect: () => {
                  setBrowsing(w);
                },
              },
              {
                label: t("worlds.openFolder"),
                onSelect: () => {
                  openFolder(w);
                },
              },
              {
                label: t("worlds.move"),
                disabled: !w.linked || running,
                onSelect: () => {
                  setMoving(w);
                },
              },
            ];
            return (
              <ContextMenuArea key={w.id} items={items}>
                <li className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-3 last:border-b-0">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{w.name}</span>
                    {repeated.has(w.name) && (
                      <span className="truncate text-xs text-muted">
                        {t("backups.folder", { id: w.id })}
                      </span>
                    )}
                    <span className="text-xs text-muted">
                      {[
                        w.lastPlayed &&
                          t("worlds.lastPlayed", {
                            date: dateFormat.format(new Date(w.lastPlayed)),
                          }),
                        w.lastBackupAt
                          ? t("backups.last", {
                              date: relativeTime(i18n.language, w.lastBackupAt),
                            })
                          : t("backups.none"),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {!w.linked && (
                      <span className="mt-1 flex items-center gap-1 text-xs text-warning">
                        <TriangleAlert size={14} aria-hidden />
                        {t("worlds.notLinked")}
                      </span>
                    )}
                  </div>
                  <Button
                    disabled={running || backUp.isPending}
                    title={running ? t("backups.runningBlocked") : undefined}
                    onClick={() => {
                      backUp.mutate([w.id]);
                    }}
                  >
                    <Archive size={16} aria-hidden />
                    {t("backups.backUp")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setBrowsing(w);
                    }}
                  >
                    {t("backups.list", { count: w.backupCount ?? 0 })}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      openFolder(w);
                    }}
                  >
                    <FolderOpen size={16} aria-hidden />
                    {t("worlds.openFolder")}
                  </Button>
                  <Button
                    disabled={!w.linked || running}
                    title={running ? t("worlds.runningBlocked") : undefined}
                    onClick={() => {
                      setMoving(w);
                    }}
                  >
                    {t("worlds.move")}
                  </Button>
                </li>
              </ContextMenuArea>
            );
          })}
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
      {browsing && (
        <BackupsDialog
          profileId={profile.id}
          world={browsing}
          running={running}
          onClose={() => {
            setBrowsing(undefined);
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
