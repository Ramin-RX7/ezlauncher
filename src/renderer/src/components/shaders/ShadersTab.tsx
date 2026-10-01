import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FolderOpen, Search, TriangleAlert, X } from "lucide-react";
import type { PackRef, ProfileInfo, ProfileShader } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { AddModDialog } from "../mods/AddModDialog";
import { SourceBadge } from "../mods/SourceBadge";
import { AddPacks } from "../resourcepacks/AddPacks";
import { PackIcon } from "../resourcepacks/PackIcon";
import { packKey, sameRef } from "../resourcepacks/packText";
import { Button } from "../ui/Button";
import { FindShadersDialog } from "./FindShadersDialog";

/**
 * A profile's shaders: which one Iris uses (written to Iris's config), the shaders
 * in the profile (Iris lists them in game), the library's others, and help getting
 * Iris when the profile doesn't have it.
 */
export function ShadersTab({ profile }: { profile: ProfileInfo }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["shaders", "profile", profile.id],
    queryFn: () => invoke("shaders:profile", profile.id),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["shaders"] });
  };
  const setActive = useMutation({
    mutationFn: (shader: PackRef | null) =>
      invoke("shaders:setActive", { profileId: profile.id, shader }),
    onSettled: refresh,
  });
  const setInProfile = useMutation({
    mutationFn: ({ sha1, present }: { sha1: string; present: boolean }) =>
      invoke("shaders:setInProfile", { profileId: profile.id, sha1, present }),
    onSettled: refresh,
  });
  const openFolder = useMutation({
    mutationFn: () => invoke("profiles:openFolder", profile.id, "shaderpacks"),
  });

  const [finding, setFinding] = useState(false);
  const [gettingIris, setGettingIris] = useState(false);
  const data = query.data;
  const locked = profile.running > 0 ? "running" : data?.locked;
  const disabled = locked !== undefined;
  const pending = setActive.isPending || setInProfile.isPending;

  if (gettingIris)
    return (
      <AddModDialog
        profile={profile}
        initialQuery="iris"
        autoSearch
        onClose={() => {
          setGettingIris(false);
          refresh();
        }}
      />
    );

  return (
    <AddPacks
      kind="shaders"
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
            {t("shaders.find.open")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              openFolder.mutate();
            }}
          >
            <FolderOpen size={16} aria-hidden />
            {t("shaders.openFolder")}
          </Button>
        </>
      }
    >
      {finding && (
        <FindShadersDialog
          profile={profile}
          onGetIris={() => {
            setFinding(false);
            setGettingIris(true);
          }}
          onClose={() => {
            setFinding(false);
          }}
        />
      )}
      {data?.iris === "missing" && (
        <div className="flex flex-wrap items-center gap-3 rounded-ezl border border-warning p-3 text-sm">
          <TriangleAlert
            size={16}
            className="shrink-0 text-warning"
            aria-hidden
          />
          <span className="flex-1">{t("shaders.iris.missing")}</span>
          <Button
            variant="primary"
            disabled={profile.running > 0}
            onClick={() => {
              setGettingIris(true);
            }}
          >
            {t("shaders.iris.install")}
          </Button>
        </div>
      )}
      {data?.iris === "noLoader" && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <TriangleAlert size={16} aria-hidden />
          {t("shaders.iris.noLoader")}
        </p>
      )}
      {locked === "running" && (
        <p className="text-sm text-muted">{t("worlds.runningBlocked")}</p>
      )}
      {[query, setActive, setInProfile, openFolder].map(
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
            <h2 id="shader-choice" className="text-sm font-semibold">
              {t("shaders.active")}
            </h2>
            <p className="text-xs text-muted">{t("shaders.activeHint")}</p>
          </div>
          <ul
            role="radiogroup"
            aria-labelledby="shader-choice"
            className="rounded-ezl border border-border bg-surface"
          >
            <li className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
              <label className="flex flex-1 cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name={`shader-${profile.id}`}
                  checked={data !== undefined && data.active === undefined}
                  disabled={disabled || pending}
                  onChange={() => {
                    setActive.mutate(null);
                  }}
                  className="accent-accent"
                />
                <span className="font-medium">{t("shaders.off")}</span>
                <span className="text-xs text-muted">
                  {t("shaders.offHint")}
                </span>
              </label>
            </li>
            {(data?.inProfile ?? []).map((shader) => (
              <ShaderRow
                key={packKey(shader.ref)}
                shader={shader}
                profileId={profile.id}
                choice={{
                  checked:
                    data?.active !== undefined &&
                    sameRef(data.active, shader.ref),
                  onChoose: () => {
                    setActive.mutate(shader.ref);
                  },
                }}
                disabled={disabled || pending}
                {...(shader.ref.kind === "library" && {
                  onRemove: () => {
                    if (shader.ref.kind === "library")
                      setInProfile.mutate({
                        sha1: shader.ref.sha1,
                        present: false,
                      });
                  },
                })}
              />
            ))}
          </ul>
          {data && data.inProfile.length === 0 && (
            <p className="text-sm text-muted">{t("shaders.noShaders")}</p>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">{t("shaders.available")}</h2>
          {data && data.available.length === 0 ? (
            <p className="rounded-ezl border border-dashed border-border p-4 text-center text-sm text-muted">
              {t("shaders.noAvailable")}
            </p>
          ) : (
            <ul className="rounded-ezl border border-border bg-surface">
              {(data?.available ?? []).map((shader) => (
                <ShaderRow
                  key={packKey(shader.ref)}
                  shader={shader}
                  profileId={profile.id}
                  disabled={disabled || pending}
                  onAdd={() => {
                    if (shader.ref.kind === "library")
                      setInProfile.mutate({
                        sha1: shader.ref.sha1,
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
            <h2 className="text-sm font-semibold">
              {t("shaders.notPacksTitle")}
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
                    ? t("shaders.notPack.nested", {
                        name: n.name,
                        folder: n.folder ?? "",
                      })
                    : t(`shaders.notPack.${n.reason}`, { name: n.name })}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AddPacks>
  );
}

/** A shader row: chosen with a radio button (profile shaders) or added (library). */
function ShaderRow({
  shader,
  profileId,
  choice,
  disabled,
  onRemove,
  onAdd,
}: {
  shader: ProfileShader;
  profileId: string;
  choice?: { checked: boolean; onChoose: () => void };
  disabled: boolean;
  onRemove?: () => void;
  onAdd?: () => void;
}) {
  const { t } = useTranslation();
  const body = (
    <>
      <PackIcon
        kind="shaders"
        packRef={shader.ref}
        hasIcon={shader.hasIcon}
        profileId={profileId}
      />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className="truncate font-medium">{shader.name}</span>
        {shader.ref.kind === "folder" && (
          <span
            className="rounded-ezl border border-border px-2 py-0.5 text-xs text-muted"
            title={t("shaders.folderHint")}
          >
            {t("shaders.folder")}
          </span>
        )}
        {shader.irisTagged === false && (
          <span
            className="text-xs text-warning"
            title={t("shaders.notIrisHint")}
          >
            {t("shaders.notIris")}
          </span>
        )}
      </span>
    </>
  );
  return (
    <li className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
      {choice ? (
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
          <input
            type="radio"
            name={`shader-${profileId}`}
            checked={choice.checked}
            disabled={disabled}
            onChange={choice.onChoose}
            className="accent-accent"
          />
          {body}
        </label>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3">{body}</span>
      )}
      {shader.source && (
        <SourceBadge
          sourceId={shader.source.sourceId}
          pageUrl={shader.source.pageUrl}
          modName={shader.name}
        />
      )}
      {onAdd && (
        <Button
          variant="secondary"
          className="h-8 px-3"
          aria-label={t("shaders.addToProfileLabel", { name: shader.name })}
          disabled={disabled}
          onClick={onAdd}
        >
          {t("shaders.addToProfile")}
        </Button>
      )}
      {onRemove && (
        <Button
          variant="ghost"
          className="h-8 px-2"
          aria-label={t("shaders.removeFromProfile", { name: shader.name })}
          disabled={disabled}
          onClick={onRemove}
        >
          <X size={16} aria-hidden />
        </Button>
      )}
    </li>
  );
}
