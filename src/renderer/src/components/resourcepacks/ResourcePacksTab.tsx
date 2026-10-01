import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FolderOpen, Search, TriangleAlert } from "lucide-react";
import type {
  ActivePack,
  ProfileInfo,
  ProfilePack,
  ProfilePacks,
} from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { SourceBadge } from "../mods/SourceBadge";
import { Button } from "../ui/Button";
import { ActivePackList } from "./ActivePackList";
import { AddPacks } from "./AddPacks";
import { FindPacksDialog } from "./FindPacksDialog";
import { PackIcon } from "./PackIcon";
import { compatTone, packKey, rowRef, sameRef } from "./packText";

/** `data` with these rows active; the packs that left the list become available again. */
function withActive(data: ProfilePacks, rows: ActivePack[]): ProfilePacks {
  const all: ProfilePack[] = [
    ...data.active.flatMap((r) => (r.kind === "pack" ? [r.pack] : [])),
    ...data.available,
  ];
  const isActive = (p: ProfilePack) =>
    rows.some((r) => r.kind === "pack" && sameRef(r.pack.ref, p.ref));
  return {
    ...data,
    active: rows,
    available: all
      .filter((p) => !isActive(p))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * A profile's resource packs: the active ones in order (written to the game's
 * options.txt), the ones it could turn on, and files that aren't packs.
 */
export function ResourcePacksTab({ profile }: { profile: ProfileInfo }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const key = ["resourcePacks", "profile", profile.id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => invoke("resourcePacks:profile", profile.id),
  });

  const save = useMutation({
    mutationFn: (rows: ActivePack[]) =>
      invoke("resourcePacks:setActive", {
        profileId: profile.id,
        active: rows.map(rowRef),
      }),
    // The list changes at once; a failed save puts it back.
    onMutate: async (rows) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<ProfilePacks>(key);
      if (before) queryClient.setQueryData(key, withActive(before, rows));
      return { before };
    },
    onError: (_err, _rows, context) => {
      if (context?.before) queryClient.setQueryData(key, context.before);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["resourcePacks"] });
    },
  });
  const openFolder = useMutation({
    mutationFn: () =>
      invoke("profiles:openFolder", profile.id, "resourcepacks"),
  });

  const [finding, setFinding] = useState(false);
  const data = query.data;
  const locked = profile.running > 0 ? "running" : (data?.locked ?? undefined);
  const disabled = locked !== undefined;
  const active = data?.active ?? [];

  return (
    <AddPacks
      profileId={profile.id}
      actions={
        <>
          <Button
            variant="primary"
            onClick={() => {
              setFinding(true);
            }}
          >
            <Search size={16} aria-hidden />
            {t("resourcePacks.find.open")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              openFolder.mutate();
            }}
          >
            <FolderOpen size={16} aria-hidden />
            {t("resourcePacks.openFolder")}
          </Button>
        </>
      }
    >
      {finding && (
        <FindPacksDialog
          profile={profile}
          onClose={() => {
            setFinding(false);
          }}
        />
      )}
      {locked && (
        <p className="flex items-center gap-2 text-sm text-muted">
          {locked !== "running" && <TriangleAlert size={16} aria-hidden />}
          {locked === "running"
            ? t("worlds.runningBlocked")
            : locked === "unsupported"
              ? t("resourcePacks.unsupported")
              : t("resourcePacks.versionUnknown")}
        </p>
      )}
      {[query, save, openFolder].map(
        (m, i) =>
          m.isError && (
            <p key={i} role="alert" className="text-sm text-danger">
              {errorMessage(t, m.error)}
            </p>
          ),
      )}

      <div className="flex min-h-0 flex-col gap-4 overflow-auto">
        <section className="flex flex-col gap-2">
          <div>
            <h2 className="text-sm font-semibold">
              {t("resourcePacks.active")}
            </h2>
            <p className="text-xs text-muted">
              {t("resourcePacks.activeHint")}
            </p>
          </div>
          {data && active.length === 0 ? (
            <p className="rounded-ezl border border-dashed border-border p-4 text-center text-sm text-muted">
              {t("resourcePacks.noActive")}
            </p>
          ) : (
            <ActivePackList
              rows={active}
              profileId={profile.id}
              disabled={disabled}
              onChange={(rows) => {
                save.mutate(rows);
              }}
              onTurnOff={(row) => {
                const off = packKey(rowRef(row));
                save.mutate(active.filter((r) => packKey(rowRef(r)) !== off));
              }}
            />
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">
            {t("resourcePacks.available")}
          </h2>
          {data && data.available.length === 0 ? (
            <p className="rounded-ezl border border-dashed border-border p-4 text-center text-sm text-muted">
              {t("resourcePacks.noAvailable")}
            </p>
          ) : (
            <ul className="rounded-ezl border border-border bg-surface">
              {(data?.available ?? []).map((pack) => (
                <AvailableRow
                  key={`${pack.ref.kind}:${pack.ref.kind === "library" ? pack.ref.sha1 : pack.ref.name}`}
                  pack={pack}
                  profileId={profile.id}
                  disabled={disabled}
                  onTurnOn={() => {
                    save.mutate([{ kind: "pack", pack }, ...active]);
                  }}
                />
              ))}
            </ul>
          )}
        </section>

        {data && data.notPacks.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">
              {t("resourcePacks.notPacksTitle")}
            </h2>
            <ul className="flex flex-col gap-1 text-sm text-warning">
              {data.notPacks.map((n) => (
                <li key={n.name} className="flex items-start gap-2">
                  <TriangleAlert
                    size={16}
                    className="mt-0.5 shrink-0"
                    aria-hidden
                  />
                  {n.reason === "nested"
                    ? t("resourcePacks.notPack.nested", {
                        name: n.name,
                        folder: n.folder ?? "",
                      })
                    : t(`resourcePacks.notPack.${n.reason}`, { name: n.name })}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AddPacks>
  );
}

function AvailableRow({
  pack,
  profileId,
  disabled,
  onTurnOn,
}: {
  pack: ProfilePack;
  profileId: string;
  disabled: boolean;
  onTurnOn: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
      <PackIcon
        packRef={pack.ref}
        hasIcon={pack.hasIcon}
        profileId={profileId}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{pack.name}</span>
          {pack.ref.kind === "folder" && (
            <span
              className="rounded-ezl border border-border px-2 py-0.5 text-xs text-muted"
              title={t("resourcePacks.folderHint")}
            >
              {t("resourcePacks.folder")}
            </span>
          )}
          {pack.source && (
            <SourceBadge
              sourceId={pack.source.sourceId}
              pageUrl={pack.source.pageUrl}
              modName={pack.name}
            />
          )}
        </span>
        {pack.description && (
          <span className="truncate text-xs text-muted">
            {pack.description}
          </span>
        )}
      </div>
      <span className={`shrink-0 text-xs ${compatTone(pack.compat)}`}>
        {t(`resourcePacks.compat.${pack.compat}`)}
      </span>
      <Button
        variant="secondary"
        className="h-8 px-3"
        aria-label={t("resourcePacks.turnOnLabel", { name: pack.name })}
        disabled={disabled}
        onClick={onTurnOn}
      >
        {t("resourcePacks.turnOn")}
      </Button>
    </li>
  );
}
