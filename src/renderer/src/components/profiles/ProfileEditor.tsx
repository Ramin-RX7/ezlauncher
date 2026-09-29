import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { joinArgs, splitArgs } from "@shared/args";
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
import { ArgsField } from "../settings/ArgsField";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Dialog } from "../ui/Dialog";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { VersionList } from "../versions/VersionList";
import { VersionRefresh } from "../versions/VersionRefresh";
import { visibleTypes } from "../versions/versionTypes";

const VANILLA = "vanilla";
const MEMORY_MIN = 512;
const MEMORY_MAX = 65536;

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
  const [gameVersion, setGameVersion] = useState<string | undefined>(
    profile?.gameVersion,
  );
  const [loaderId, setLoaderId] = useState<string | null>(
    profile?.loader?.id ?? null,
  );
  // Each override: "use global" (the default), or the profile's own value that replaces it.
  const [globalMemory, setGlobalMemory] = useState(
    profile?.memoryMaxMb === undefined,
  );
  const [memory, setMemory] = useState(
    profile?.memoryMaxMb !== undefined ? String(profile.memoryMaxMb) : "",
  );
  const [globalJvm, setGlobalJvm] = useState(
    profile?.extraJvmArgs === undefined,
  );
  const [jvmArgs, setJvmArgs] = useState(joinArgs(profile?.extraJvmArgs ?? []));
  const [globalGame, setGlobalGame] = useState(
    profile?.extraGameArgs === undefined,
  );
  const [gameArgs, setGameArgs] = useState(
    joinArgs(profile?.extraGameArgs ?? []),
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
  const memoryNumber = Number(memory);
  const memoryValid =
    globalMemory ||
    (memory.trim() !== "" &&
      Number.isInteger(memoryNumber) &&
      memoryNumber >= MEMORY_MIN &&
      memoryNumber <= MEMORY_MAX);
  const jvmSplit = splitArgs(jvmArgs);
  const gameSplit = splitArgs(gameArgs);
  const argsValid =
    (globalJvm || !("error" in jvmSplit)) &&
    (globalGame || !("error" in gameSplit));
  const loaderOk = loaderId === null || supports(loaderId);
  const valid =
    trimmedName.length > 0 &&
    trimmedName.length <= PROFILE_NAME_MAX &&
    gameVersion !== undefined &&
    memoryValid &&
    argsValid &&
    loaderOk &&
    !running;

  const input = (): ProfileInput => ({
    name: trimmedName,
    gameVersion: gameVersion ?? "",
    loader: loaderId ? { id: loaderId } : null,
    memoryMaxMb: globalMemory ? null : memoryNumber,
    extraJvmArgs: globalJvm || "error" in jvmSplit ? null : jvmSplit.args,
    extraGameArgs: globalGame || "error" in gameSplit ? null : gameSplit.args,
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
      {running && (
        <p role="status" className="text-sm text-warning">
          {t("profiles.editor.running")}
        </p>
      )}
      <fieldset
        disabled={running}
        className="flex min-h-0 flex-1 flex-col gap-4 disabled:opacity-60"
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
            types={visibleTypes(settings.data)}
            selectedId={gameVersion}
            onSelect={(id) => {
              setGameVersion(id);
              setSaved(false);
            }}
          />
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t("profiles.editor.memory")}</span>
            <Checkbox
              checked={globalMemory}
              onChange={(checked) => {
                setGlobalMemory(checked);
                if (!checked && memory === "")
                  setMemory(String(settings.data?.memoryMaxMb ?? 2048));
                setSaved(false);
              }}
            >
              {t("profiles.editor.useGlobal")}{" "}
              <span className="text-muted">
                (
                {t("profiles.editor.globalMemory", {
                  mb: settings.data?.memoryMaxMb ?? 2048,
                })}
                )
              </span>
            </Checkbox>
            {!globalMemory && (
              <>
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
                  {t("profiles.editor.memoryHint")}
                </span>
              </>
            )}
          </div>
          <Override
            label={t("profiles.editor.jvmArgs")}
            global={globalJvm}
            globalArgs={settings.data?.extraJvmArgs ?? []}
            onGlobal={(checked) => {
              setGlobalJvm(checked);
              if (!checked && jvmArgs === "")
                setJvmArgs(joinArgs(settings.data?.extraJvmArgs ?? []));
              setSaved(false);
            }}
          >
            <ArgsField
              label={t("profiles.editor.jvmArgs")}
              hint={t("profiles.editor.jvmArgsHint")}
              jvm
              text={jvmArgs}
              onText={(text) => {
                setJvmArgs(text);
                setSaved(false);
              }}
            />
          </Override>
          <Override
            label={t("profiles.editor.gameArgs")}
            global={globalGame}
            globalArgs={settings.data?.extraGameArgs ?? []}
            onGlobal={(checked) => {
              setGlobalGame(checked);
              if (!checked && gameArgs === "")
                setGameArgs(joinArgs(settings.data?.extraGameArgs ?? []));
              setSaved(false);
            }}
          >
            <ArgsField
              label={t("profiles.editor.gameArgs")}
              hint={t("profiles.editor.gameArgsHint")}
              text={gameArgs}
              onText={(text) => {
                setGameArgs(text);
                setSaved(false);
              }}
            />
          </Override>
        </div>
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

/** "Use global setting" for a list of arguments; unticked shows the profile's own field. */
function Override({
  label,
  global,
  globalArgs,
  onGlobal,
  children,
}: {
  label: string;
  global: boolean;
  globalArgs: readonly string[];
  onGlobal: (checked: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1 text-sm">
      {global && <span className="font-medium">{label}</span>}
      <Checkbox checked={global} onChange={onGlobal}>
        {t("profiles.editor.useGlobal")}{" "}
        <span className="text-muted">
          (
          {globalArgs.length > 0
            ? t("profiles.editor.globalArgs", { args: joinArgs(globalArgs) })
            : t("profiles.editor.globalNone")}
          )
        </span>
      </Checkbox>
      {!global && children}
    </div>
  );
}
