import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FolderOpen, Search, TriangleAlert } from "lucide-react";
import type { ProfileInfo, WorldDataPack, WorldInfo } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { SourceBadge } from "../mods/SourceBadge";
import { AddPacks } from "../resourcepacks/AddPacks";
import { PackIcon } from "../resourcepacks/PackIcon";
import { compatTone, packKey } from "../resourcepacks/packText";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FindDataPacksDialog } from "./FindDataPacksDialog";

/**
 * One world's data packs: the ones in it (the game turns new ones on when the
 * world loads), library packs to add, and files that aren't data packs.
 */
export function WorldDataPacksDialog({
  world,
  profile,
  onClose,
}: {
  world: WorldInfo;
  profile: ProfileInfo;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["dataPacks", "world", world.id],
    queryFn: () => invoke("dataPacks:world", world.id),
  });
  const setInWorld = useMutation({
    mutationFn: ({ sha1, present }: { sha1: string; present: boolean }) =>
      invoke("dataPacks:setInWorld", { worldId: world.id, sha1, present }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["dataPacks"] });
    },
  });
  const openFolder = useMutation({
    mutationFn: () => invoke("dataPacks:openFolder", world.id),
  });
  const [finding, setFinding] = useState(false);

  const data = query.data;
  const locked = profile.running > 0 ? "running" : data?.locked;
  const disabled = locked !== undefined || setInWorld.isPending;

  if (finding)
    return (
      <FindDataPacksDialog
        world={world}
        profile={profile}
        onClose={() => {
          setFinding(false);
        }}
      />
    );

  return (
    <Dialog
      open
      wide
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("dataPacks.dialog.title", { world: world.name })}
      description={t("dataPacks.dialog.hint")}
      closeLabel={t("dataPacks.cancel")}
    >
      <AddPacks
        kind="dataPacks"
        worldId={world.id}
        actions={
          <>
            <Button
              variant="primary"
              disabled={locked === "unsupported"}
              onClick={() => {
                setFinding(true);
              }}
            >
              <Search size={16} aria-hidden />
              {t("dataPacks.find.open")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                openFolder.mutate();
              }}
            >
              <FolderOpen size={16} aria-hidden />
              {t("dataPacks.openFolder")}
            </Button>
          </>
        }
      >
        {locked && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <TriangleAlert size={16} aria-hidden />
            {locked === "running"
              ? t("worlds.runningBlocked")
              : t("dataPacks.unsupported")}
          </p>
        )}
        {[query, setInWorld, openFolder].map(
          (m, i) =>
            m.isError && (
              <p key={i} role="alert" className="text-sm text-danger">
                {errorMessage(t, m.error)}
              </p>
            ),
        )}
        <div className="flex max-h-[55vh] min-h-0 flex-col gap-4 overflow-auto">
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              {t("dataPacks.dialog.inWorld")}
            </h3>
            {data && data.inWorld.length === 0 ? (
              <p className="rounded-ezl border border-dashed border-border p-4 text-center text-sm text-muted">
                {t("dataPacks.dialog.none")}
              </p>
            ) : (
              <ul className="rounded-ezl border border-border bg-surface">
                {(data?.inWorld ?? []).map((pack) => (
                  <PackRow
                    key={packKey(pack.ref)}
                    pack={pack}
                    worldId={world.id}
                    disabled={disabled}
                    {...(pack.ref.kind === "library" && {
                      onRemove: () => {
                        if (pack.ref.kind === "library")
                          setInWorld.mutate({
                            sha1: pack.ref.sha1,
                            present: false,
                          });
                      },
                    })}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              {t("dataPacks.dialog.available")}
            </h3>
            {data && data.available.length === 0 ? (
              <p className="rounded-ezl border border-dashed border-border p-4 text-center text-sm text-muted">
                {t("dataPacks.dialog.noAvailable")}
              </p>
            ) : (
              <ul className="rounded-ezl border border-border bg-surface">
                {(data?.available ?? []).map((pack) => (
                  <PackRow
                    key={packKey(pack.ref)}
                    pack={pack}
                    worldId={world.id}
                    disabled={disabled}
                    onAdd={() => {
                      if (pack.ref.kind === "library")
                        setInWorld.mutate({
                          sha1: pack.ref.sha1,
                          present: true,
                        });
                    }}
                  />
                ))}
              </ul>
            )}
          </section>

          {data && data.notPacks.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">
                {t("dataPacks.notPacksTitle")}
              </h3>
              <ul className="flex flex-col gap-1 text-sm text-warning">
                {data.notPacks.map((n) => (
                  <li key={n.name} className="flex items-start gap-2">
                    <TriangleAlert
                      size={16}
                      className="mt-0.5 shrink-0"
                      aria-hidden
                    />
                    {n.reason === "nested"
                      ? t("dataPacks.notPack.nested", {
                          name: n.name,
                          folder: n.folder ?? "",
                        })
                      : t(`dataPacks.notPack.${n.reason}`, { name: n.name })}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </AddPacks>
    </Dialog>
  );
}

function PackRow({
  pack,
  worldId,
  disabled,
  onAdd,
  onRemove,
}: {
  pack: WorldDataPack;
  worldId: string;
  disabled: boolean;
  onAdd?: () => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
      <PackIcon
        kind="dataPacks"
        packRef={pack.ref}
        hasIcon={pack.hasIcon}
        profileId={worldId}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{pack.name}</span>
          {pack.ref.kind === "folder" && (
            <span
              className="rounded-ezl border border-border px-2 py-0.5 text-xs text-muted"
              title={t("dataPacks.folderHint")}
            >
              {t("dataPacks.folder")}
            </span>
          )}
          {pack.source && (
            <SourceBadge
              sourceId={pack.source.sourceId}
              pageUrl={pack.source.pageUrl}
              modName={pack.name}
            />
          )}
          {onRemove !== undefined && pack.offInGame && (
            <span className="text-xs text-warning">
              {t("dataPacks.offInGame")}
            </span>
          )}
        </span>
        {pack.description && (
          <span className="truncate text-xs text-muted">
            {pack.description}
          </span>
        )}
        {pack.missingFeatures.length > 0 && (
          <span className="text-xs text-warning">
            {t("dataPacks.needsFeatures", {
              features: pack.missingFeatures.join(", "),
            })}
          </span>
        )}
      </div>
      <span className={`shrink-0 text-xs ${compatTone(pack.compat)}`}>
        {t(`resourcePacks.compat.${pack.compat}`)}
      </span>
      {onAdd && (
        <Button
          variant="secondary"
          className="h-8 px-3"
          aria-label={t("dataPacks.dialog.addLabel", { name: pack.name })}
          disabled={disabled}
          onClick={onAdd}
        >
          {t("dataPacks.dialog.add")}
        </Button>
      )}
      {onRemove && (
        <Button
          variant="ghost"
          className="h-8 px-3 text-danger"
          aria-label={t("dataPacks.dialog.removeLabel", { name: pack.name })}
          disabled={disabled}
          onClick={onRemove}
        >
          {t("dataPacks.dialog.remove")}
        </Button>
      )}
    </li>
  );
}
