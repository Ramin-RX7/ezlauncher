import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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

const VANILLA = "vanilla";
const MEMORY_MIN = 512;
const MEMORY_MAX = 65536;

export interface ProfileEditorProps {
  /** Missing = create a new profile. */
  profile?: Profile;
  onSaved: (profile: Profile) => void;
  onCancel?: () => void;
}

/** Create or edit a profile: name, version, loader and optional settings. */
export function ProfileEditor({
  profile,
  onSaved,
  onCancel,
}: ProfileEditorProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const versions = useVersionList();
  const loaders = useLoaders();
  const settings = useSettings();

  const [name, setName] = useState(profile?.name ?? "");
  const [gameVersion, setGameVersion] = useState<string | undefined>(
    profile?.gameVersion,
  );
  const [loaderId, setLoaderId] = useState<string | null>(
    profile?.loader?.id ?? null,
  );
  const [memory, setMemory] = useState(
    profile?.memoryMaxMb !== undefined ? String(profile.memoryMaxMb) : "",
  );
  const [jvmArgs, setJvmArgs] = useState(
    (profile?.extraJvmArgs ?? []).join("\n"),
  );
  const [confirming, setConfirming] = useState(false);
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
  const memoryNumber = memory.trim() === "" ? null : Number(memory);
  const memoryValid =
    memoryNumber === null ||
    (Number.isInteger(memoryNumber) &&
      memoryNumber >= MEMORY_MIN &&
      memoryNumber <= MEMORY_MAX);
  const loaderOk = loaderId === null || supports(loaderId);
  const valid =
    trimmedName.length > 0 &&
    trimmedName.length <= PROFILE_NAME_MAX &&
    gameVersion !== undefined &&
    memoryValid &&
    loaderOk;

  const input = (): ProfileInput => ({
    name: trimmedName,
    gameVersion: gameVersion ?? "",
    loader: loaderId ? { id: loaderId } : null,
    memoryMaxMb: memoryNumber,
    extraJvmArgs: jvmArgs
      .split(/\r?\n/)
      .map((a) => a.trim())
      .filter(Boolean),
  });

  const save = useMutation({
    mutationFn: (data: ProfileInput) =>
      profile
        ? invoke("profiles:update", profile.id, data)
        : invoke("profiles:create", data),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: keys.profiles });
      setSaved(true);
      onSaved(result);
    },
  });

  const changesInstall =
    profile !== undefined &&
    (gameVersion !== profile.gameVersion ||
      loaderId !== (profile.loader?.id ?? null));

  const submit = () => {
    if (!valid) return;
    if (changesInstall) setConfirming(true);
    else save.mutate(input());
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onChange={() => {
        setSaved(false);
      }}
    >
      <div className="flex flex-wrap items-end gap-4">
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
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">{t("profiles.editor.loader")}</span>
          <Select
            aria-label={t("profiles.editor.loader")}
            value={loaderId ?? VANILLA}
            className="w-56"
            onChange={(v) => {
              setLoaderId(v === VANILLA ? null : v);
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
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-muted">{t("profiles.editor.version")}</span>
          <span className="h-9 content-center font-medium">
            {gameVersion ?? t("profiles.editor.pickVersion")}
          </span>
        </div>
      </div>

      <VersionRefresh />
      <div className="flex h-80 min-h-0 flex-col">
        <VersionList
          versions={list}
          selectedId={gameVersion}
          onSelect={(id) => {
            setGameVersion(id);
            setSaved(false);
          }}
        />
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">{t("profiles.editor.memory")}</span>
          <Input
            type="number"
            inputMode="numeric"
            min={MEMORY_MIN}
            max={MEMORY_MAX}
            step={256}
            value={memory}
            aria-label={t("profiles.editor.memory")}
            aria-invalid={!memoryValid}
            aria-describedby="memory-hint"
            onChange={(e) => {
              setMemory(e.target.value);
            }}
            className="w-40"
          />
          <span id="memory-hint" className="text-xs text-muted">
            {t("profiles.editor.memoryHint", {
              mb: settings.data?.memoryMaxMb ?? 2048,
            })}
          </span>
        </label>
        <label className="flex min-w-72 flex-1 flex-col gap-1 text-sm">
          <span className="text-muted">{t("profiles.editor.jvmArgs")}</span>
          <textarea
            value={jvmArgs}
            rows={3}
            spellCheck={false}
            aria-label={t("profiles.editor.jvmArgs")}
            aria-describedby="jvm-hint"
            onChange={(e) => {
              setJvmArgs(e.target.value);
            }}
            className="rounded-ezl border border-border bg-surface px-3 py-2 font-mono text-xs text-text focus:border-accent focus:outline-none"
          />
          <span id="jvm-hint" className="text-xs text-muted">
            {t("profiles.editor.jvmArgsHint")}
          </span>
        </label>
      </div>

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
                save.mutate(input());
              }}
            >
              {t("profiles.changeWarning.confirm")}
            </Button>
          </>
        }
      />
    </form>
  );
}
