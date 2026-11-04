import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  PROFILE_NAME_MAX,
  type Profile,
  type ProfileInput,
} from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import {
  keys,
  useLoaders,
  useSettings,
  useVersionList,
} from "../../state/queries";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { VersionList } from "../versions/VersionList";
import { VersionRefresh } from "../versions/VersionRefresh";
import { visibleTypes } from "../versions/versionTypes";
import { ApplyModsDialog } from "./ApplyModsDialog";
import { IconPicker } from "./IconPicker";
import { LaunchOverrides } from "./LaunchOverrides";
import { useLaunchOverrides } from "./useLaunchOverrides";

const VANILLA = "vanilla";
const NEWEST = "newest";

export interface ProfileEditorProps {
  /** Missing = create a new profile. */
  profile?: Profile;
  onSaved: (profile: Profile) => void;
  onCancel?: () => void;
  /** A game of this profile runs: nothing can be changed until it closes. */
  running?: boolean;
}

/** Create or edit a profile: name, version, loader and optional settings. */
export function ProfileEditor({
  profile,
  onSaved,
  onCancel,
  running = false,
}: ProfileEditorProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const versions = useVersionList();
  const loaders = useLoaders();
  const settings = useSettings();

  const [name, setName] = useState(profile?.name ?? "");
  const [iconId, setIconId] = useState<string | undefined>(profile?.iconId);
  const [gameVersion, setGameVersion] = useState<string | undefined>(
    profile?.gameVersion,
  );
  const [loaderId, setLoaderId] = useState<string | null>(
    profile?.loader?.id ?? null,
  );
  /** A pinned loader build; null = the newest at install time. */
  const [loaderBuild, setLoaderBuild] = useState<string | null>(
    profile?.loader?.version ?? null,
  );
  const overrides = useLaunchOverrides(profile);
  const [confirming, setConfirming] = useState(false);
  // Changing an existing profile's version or loader is rare: it starts folded away.
  const [versionOpen, setVersionOpen] = useState(profile === undefined);
  const [saved, setSaved] = useState(false);

  const list = useMemo(() => versions.data?.versions ?? [], [versions.data]);
  // Loader installs already on disk stay playable offline.
  const installedLoaders = useMemo(
    () =>
      new Set(
        list
          .filter((v) => v.loader && v.loader.gameVersion === gameVersion)
          .map((v) => v.loader?.id),
      ),
    [list, gameVersion],
  );
  const supports = (id: string) =>
    gameVersion !== undefined &&
    (installedLoaders.has(id) ||
      (id === profile?.loader?.id && gameVersion === profile.gameVersion) ||
      (loaders.data
        ?.find((l) => l.id === id)
        ?.gameVersions?.includes(gameVersion) ??
        false));

  const trimmedName = name.trim();
  const loaderOk = loaderId === null || supports(loaderId);
  const valid =
    trimmedName.length > 0 &&
    trimmedName.length <= PROFILE_NAME_MAX &&
    gameVersion !== undefined &&
    overrides.valid &&
    loaderOk &&
    !running;

  const input = (): ProfileInput => ({
    name: trimmedName,
    gameVersion: gameVersion ?? "",
    loader: loaderId
      ? { id: loaderId, ...(loaderBuild !== null && { version: loaderBuild }) }
      : null,
    iconId: iconId ?? null,
    ...overrides.values(),
  });

  // After a version/loader change, offer to re-fetch the profile's mods.
  const offerApply = useRef(false);
  const [applyOpen, setApplyOpen] = useState(false);

  const save = useMutation({
    mutationFn: (data: ProfileInput) =>
      profile
        ? invoke("profiles:update", profile.id, data)
        : invoke("profiles:create", data),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: keys.profiles });
      setSaved(true);
      onSaved(result);
      if (offerApply.current) setApplyOpen(true);
    },
  });

  const changesInstall =
    profile !== undefined &&
    (gameVersion !== profile.gameVersion ||
      loaderId !== (profile.loader?.id ?? null) ||
      loaderBuild !== (profile.loader?.version ?? null));

  const doSave = (data: ProfileInput) => {
    offerApply.current = changesInstall && data.loader !== null;
    save.mutate(data);
  };

  const submit = () => {
    if (!valid) return;
    if (changesInstall) setConfirming(true);
    else doSave(input());
  };

  return (
    <form
      className="flex shrink-0 flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onChange={() => {
        setSaved(false);
      }}
    >
      {running && (
        <p role="status" className="text-sm text-warning">
          {t("profiles.editor.running")}
        </p>
      )}
      <fieldset
        disabled={running}
        className="flex flex-col gap-4 disabled:opacity-60"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-muted">{t("profiles.editor.icon")}</span>
            <IconPicker
              value={iconId}
              onChange={(id) => {
                setIconId(id);
                setSaved(false);
              }}
            />
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">{t("profiles.editor.name")}</span>
            <Input
              value={name}
              maxLength={PROFILE_NAME_MAX}
              placeholder={t("profiles.editor.namePlaceholder")}
              aria-invalid={name.length > 0 && trimmedName.length === 0}
              onChange={(e) => {
                setName(e.target.value);
              }}
              className="w-64"
            />
          </label>
        </div>

        {versionOpen ? (
          // Version, then loader: the loaders offered depend on the version.
          <div className="flex w-full max-w-4xl flex-col gap-4">
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{t("profiles.editor.version")}</span>
              <div className="flex h-9 items-center gap-3">
                <span className="font-medium">
                  {gameVersion ?? t("profiles.editor.pickVersion")}
                </span>
                {profile && (
                  <Button
                    onClick={() => {
                      // Keep the profile as it is.
                      setGameVersion(profile.gameVersion);
                      setLoaderId(profile.loader?.id ?? null);
                      setLoaderBuild(profile.loader?.version ?? null);
                      setVersionOpen(false);
                    }}
                  >
                    {t("profiles.editor.keepVersion")}
                  </Button>
                )}
              </div>
            </div>
            {/* Enough rows to pick from, whatever the window size (the page scrolls). */}
            <div className="flex h-[min(32rem,60vh)] min-h-80 shrink-0 flex-col">
              <VersionList
                toolbar={<VersionRefresh />}
                versions={list}
                types={visibleTypes(settings.data)}
                selectedId={gameVersion}
                onSelect={(id) => {
                  setGameVersion(id);
                  // A build is made for one Minecraft version.
                  if (id !== gameVersion) setLoaderBuild(null);
                  setSaved(false);
                }}
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">
                  {t("profiles.editor.loader")}
                </span>
                <Select
                  aria-label={t("profiles.editor.loader")}
                  value={loaderId ?? VANILLA}
                  className="w-56"
                  onChange={(v) => {
                    setLoaderId(v === VANILLA ? null : v);
                    setLoaderBuild(null);
                    setSaved(false);
                  }}
                  options={[
                    { value: VANILLA, label: t("loaders.vanilla") },
                    ...(loaders.data ?? []).map((l) => {
                      const ok = supports(l.id);
                      return {
                        value: l.id,
                        label: ok
                          ? l.displayName
                          : t("loaders.unsupported", { name: l.displayName }),
                        disabled: !ok,
                      };
                    }),
                  ]}
                />
              </label>
              {loaderId !== null && gameVersion !== undefined && (
                <LoaderBuildSelect
                  loaderId={loaderId}
                  gameVersion={gameVersion}
                  value={loaderBuild}
                  onChange={(v) => {
                    setLoaderBuild(v);
                    setSaved(false);
                  }}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-muted">
              {t("profiles.editor.versionAndLoader")}
            </span>
            <div className="flex h-9 items-center gap-3">
              <span className="font-medium">
                {[
                  gameVersion,
                  loaderId
                    ? (loaders.data?.find((l) => l.id === loaderId)
                        ?.displayName ?? loaderId)
                    : t("loaders.vanilla"),
                  ...(loaderId && loaderBuild ? [loaderBuild] : []),
                ].join(" · ")}
              </span>
              <Button
                onClick={() => {
                  setVersionOpen(true);
                }}
              >
                {t("profiles.editor.changeVersion")}
              </Button>
            </div>
          </div>
        )}

        <LaunchOverrides
          overrides={overrides}
          onChange={() => {
            setSaved(false);
          }}
        />
      </fieldset>

      {save.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, save.error)}
        </p>
      )}
      <div className="flex items-center justify-end gap-3">
        {!profile && (
          <span className="me-auto text-xs text-muted">
            {t("profiles.editor.nothingDownloaded")}
          </span>
        )}
        {saved && profile && (
          <span className="text-sm text-muted" aria-live="polite">
            {t("profiles.editor.saved")}
          </span>
        )}
        {onCancel && (
          <Button onClick={onCancel}>{t("profiles.editor.cancel")}</Button>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={!valid || save.isPending}
        >
          {profile ? t("profiles.editor.save") : t("profiles.editor.create")}
        </Button>
      </div>

      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("profiles.changeWarning.title")}
        description={t("profiles.changeWarning.body")}
        closeLabel={t("profiles.changeWarning.cancel")}
        footer={
          <>
            <Button
              onClick={() => {
                setConfirming(false);
              }}
            >
              {t("profiles.changeWarning.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(false);
                doSave(input());
              }}
            >
              {t("profiles.changeWarning.confirm")}
            </Button>
          </>
        }
      >
        {profile?.modpack && (
          <p className="text-sm text-warning">
            {t("profiles.changeWarning.modpack")}
          </p>
        )}
      </Dialog>

      {applyOpen && profile && (
        <ApplyModsDialog
          profileId={profile.id}
          onClose={() => {
            setApplyOpen(false);
          }}
        />
      )}
    </form>
  );
}

/** "Newest" or one pinned loader build; the list comes from the loader's server. */
function LoaderBuildSelect({
  loaderId,
  gameVersion,
  value,
  onChange,
}: {
  loaderId: string;
  gameVersion: string;
  value: string | null;
  onChange: (build: string | null) => void;
}) {
  const { t } = useTranslation();
  const builds = useQuery({
    queryKey: ["loaderBuilds", loaderId, gameVersion],
    queryFn: () => invoke("loaders:builds", { loaderId, gameVersion }),
    staleTime: Infinity,
    retry: false,
  });
  const list = builds.data ?? [];
  // A pinned build stays choosable offline, or when the server dropped it.
  const shown =
    value !== null && !list.some((b) => b.version === value)
      ? [{ version: value, stable: true }, ...list]
      : list;
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted">{t("profiles.editor.loaderBuild")}</span>
      <Select
        aria-label={t("profiles.editor.loaderBuild")}
        value={value ?? NEWEST}
        className="w-56"
        onChange={(v) => {
          onChange(v === NEWEST ? null : v);
        }}
        options={[
          { value: NEWEST, label: t("profiles.editor.loaderNewest") },
          ...shown.map((b) => ({
            value: b.version,
            label: b.stable
              ? b.version
              : t("profiles.editor.loaderUnstable", { version: b.version }),
          })),
        ]}
      />
      {builds.isError && (
        <span className="text-xs text-muted">
          {t("profiles.editor.loaderBuildsOffline")}
        </span>
      )}
    </label>
  );
}
