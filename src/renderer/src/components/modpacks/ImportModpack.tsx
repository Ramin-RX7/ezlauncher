import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Search, TriangleAlert } from "lucide-react";
import {
  PROFILE_NAME_MAX,
  type ModpackPreview,
  type ModpackProgress,
  type Profile,
  type RemotePack,
} from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { formatSize } from "../../lib/formatSize";
import { useIpcEvent } from "../../lib/useIpcEvent";
import { keys } from "../../state/queries";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { FileDropZone } from "../ui/FileDropZone";
import { Input } from "../ui/Input";
import { Progress } from "../ui/Progress";
import { Select } from "../ui/Select";
import { FindModpacksDialog } from "./FindModpacksDialog";
import { isSupportedPack, loaderLabel } from "./modpackText";

const MRPACK = /\.mrpack$/i;

/**
 * A new profile from a mod pack: a `.mrpack` file (dropped or picked) or one found on
 * Modrinth, then a review (name, optional files), then the import.
 */
export function ImportModpack({
  onImported,
  onCancel,
}: {
  onImported: (profile: Profile) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [finding, setFinding] = useState(false);
  const [chosen, setChosen] = useState<RemotePack>();
  const [preview, setPreview] = useState<ModpackPreview>();

  const open = useMutation({
    mutationFn: (paths: string[] | "picker") =>
      paths === "picker"
        ? invoke("modpacks:pickFile")
        : invoke("modpacks:inspectFile", paths[0] ?? ""),
    onSuccess: (result) => {
      if (result) setPreview(result);
    },
  });

  const back = () => {
    if (preview) void invoke("modpacks:discard", preview.token);
    setPreview(undefined);
  };

  if (preview)
    return <Review preview={preview} onBack={back} onImported={onImported} />;

  if (chosen)
    return (
      <VersionStep
        pack={chosen}
        onBack={() => {
          setChosen(undefined);
        }}
        onRead={setPreview}
      />
    );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t("modpacks.import.intro")}</p>
      <FileDropZone
        accept={MRPACK}
        onAdd={(paths) => {
          open.mutate(paths);
        }}
        pending={open.isPending}
        addLabel={t("modpacks.import.pick")}
        dropHint={t("modpacks.import.drop")}
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setFinding(true);
            }}
          >
            <Search size={16} aria-hidden />
            {t("modpacks.import.find")}
          </Button>
        }
        status={
          open.isError && (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(t, open.error)}
            </p>
          )
        }
      >
        <div className="flex min-h-32 items-center justify-center rounded-ezl border border-dashed border-border p-6 text-center text-sm text-muted">
          {open.isPending
            ? t("modpacks.import.reading")
            : t("modpacks.import.dropArea")}
        </div>
      </FileDropZone>
      {onCancel && (
        <div className="flex justify-end">
          <Button onClick={onCancel}>{t("modpacks.cancel")}</Button>
        </div>
      )}
      {finding && (
        <FindModpacksDialog
          onChoose={(hit) => {
            setFinding(false);
            setChosen(hit);
          }}
          onClose={() => {
            setFinding(false);
          }}
        />
      )}
    </div>
  );
}

/** Pick a version of a pack found on a site, then download and read it. */
function VersionStep({
  pack,
  onBack,
  onRead,
}: {
  pack: RemotePack;
  onBack: () => void;
  onRead: (preview: ModpackPreview) => void;
}) {
  const { t } = useTranslation();
  const versions = useQuery({
    queryKey: ["modpacks", "versions", pack.sourceId, pack.projectId],
    queryFn: () =>
      invoke("modpacks:versions", {
        sourceId: pack.sourceId,
        projectId: pack.projectId,
      }),
  });
  const list = versions.data ?? [];
  const firstOk = list.find((v) => isSupportedPack(v.loaders));
  const [picked, setPicked] = useState<string>();
  const versionId = picked ?? firstOk?.versionId;
  const [progress, setProgress] = useState<ModpackProgress>();
  useIpcEvent("modpacks:progress", (p) => {
    if (p.token === versionId) setProgress(p);
  });
  const read = useMutation({
    mutationFn: (id: string) =>
      invoke("modpacks:inspectRemote", {
        sourceId: pack.sourceId,
        projectId: pack.projectId,
        versionId: id,
      }),
    onMutate: () => {
      setProgress(undefined);
    },
    onSuccess: onRead,
  });
  const cancelled =
    (read.error as { code?: string } | null)?.code === "CANCELLED";

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <BackLink onClick={onBack} disabled={read.isPending} />
      <div className="flex items-center gap-3">
        {pack.iconUrl && (
          <img src={pack.iconUrl} alt="" className="size-12 rounded-ezl" />
        )}
        <div className="flex flex-col">
          <span className="font-semibold">{pack.name}</span>
          {pack.author && (
            <span className="text-xs text-muted">
              {t("remote.by", { author: pack.author })}
            </span>
          )}
        </div>
      </div>
      {versions.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, versions.error)}
        </p>
      )}
      {versions.isSuccess && list.length === 0 && (
        <p className="text-sm text-muted">{t("modpacks.import.noVersions")}</p>
      )}
      {list.length > 0 && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">{t("modpacks.import.version")}</span>
          <Select
            aria-label={t("modpacks.import.version")}
            value={versionId ?? ""}
            disabled={read.isPending}
            onChange={setPicked}
            options={list.map((v) => {
              const ok = isSupportedPack(v.loaders);
              const label = [
                v.versionNumber,
                v.gameVersions.join(", "),
                v.loaders.map((l) => loaderLabel(t, l)).join(", "),
              ].join(" · ");
              return {
                value: v.versionId,
                label: ok ? label : t("modpacks.unsupportedVersion", { label }),
                disabled: !ok,
              };
            })}
          />
        </label>
      )}
      {read.isPending && (
        <Progress
          label={t("modpacks.import.downloadingPack")}
          {...(progress &&
            progress.totalBytes > 0 && {
              value: (progress.bytes / progress.totalBytes) * 100,
            })}
        />
      )}
      {read.isError && !cancelled && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, read.error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {read.isPending ? (
          <Button
            onClick={() => {
              if (versionId) void invoke("modpacks:cancel", versionId);
            }}
          >
            {t("modpacks.cancel")}
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!versionId}
            onClick={() => {
              if (versionId) read.mutate(versionId);
            }}
          >
            {t("modpacks.import.next")}
          </Button>
        )}
      </div>
    </div>
  );
}

/** What the pack is and what it brings; name the profile, choose optional files, import. */
function Review({
  preview,
  onBack,
  onImported,
}: {
  preview: ModpackPreview;
  onBack: () => void;
  onImported: (profile: Profile) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState(preview.name.slice(0, PROFILE_NAME_MAX));
  const [skip, setSkip] = useState<ReadonlySet<string>>(new Set());
  const [progress, setProgress] = useState<ModpackProgress>();
  useIpcEvent("modpacks:progress", (p) => {
    if (p.token === preview.token) setProgress(p);
  });
  const run = useMutation({
    mutationFn: () =>
      invoke("modpacks:import", {
        token: preview.token,
        name: name.trim(),
        skip: [...skip],
      }),
    onMutate: () => {
      setProgress(undefined);
    },
    onSuccess: (profile) => {
      void queryClient.invalidateQueries({ queryKey: keys.profiles });
      onImported(profile);
    },
  });
  const cancelled =
    (run.error as { code?: string } | null)?.code === "CANCELLED";
  const trimmed = name.trim();
  const percent =
    progress && progress.totalBytes > 0
      ? (progress.bytes / progress.totalBytes) * 100
      : undefined;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <BackLink onClick={onBack} disabled={run.isPending} />
      <div className="flex items-center gap-3">
        {preview.iconUrl && (
          <img src={preview.iconUrl} alt="" className="size-12 rounded-ezl" />
        )}
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">
            {t("modpacks.badge", {
              name: preview.name,
              version: preview.versionNumber,
            })}
          </span>
          {preview.summary && (
            <span className="line-clamp-2 text-sm text-muted">
              {preview.summary}
            </span>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">{t("modpacks.import.minecraft")}</dt>
        <dd>{preview.gameVersion}</dd>
        <dt className="text-muted">{t("modpacks.import.loader")}</dt>
        <dd>
          {preview.loader
            ? [loaderLabel(t, preview.loader), preview.loaderVersion]
                .filter(Boolean)
                .join(" ")
            : t("loaders.vanilla")}
        </dd>
        <dt className="text-muted">{t("modpacks.import.contents")}</dt>
        <dd>
          {t("modpacks.import.counts", {
            files: preview.files,
            size: formatSize(t, preview.downloadBytes),
            included: preview.included,
            includedSize: formatSize(t, preview.includedBytes),
          })}
        </dd>
      </dl>
      {!preview.supported ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-danger">
          <TriangleAlert size={16} aria-hidden />
          {t("modpacks.needsLoader", {
            loader: loaderLabel(t, preview.loader ?? ""),
          })}
        </p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">{t("profiles.editor.name")}</span>
            <Input
              value={name}
              maxLength={PROFILE_NAME_MAX}
              disabled={run.isPending}
              onChange={(e) => {
                setName(e.target.value);
              }}
              className="w-64"
            />
          </label>
          {preview.optional.length > 0 && (
            <fieldset
              disabled={run.isPending}
              className="flex flex-col gap-1 text-sm"
            >
              <legend className="mb-1 font-medium">
                {t("modpacks.import.optional")}
              </legend>
              <p className="mb-1 text-xs text-muted">
                {t("modpacks.import.optionalHint")}
              </p>
              {preview.optional.map((f) => (
                <Checkbox
                  key={f.path}
                  checked={!skip.has(f.path)}
                  onChange={(checked) => {
                    setSkip((s) => {
                      const next = new Set(s);
                      if (checked) next.delete(f.path);
                      else next.add(f.path);
                      return next;
                    });
                  }}
                >
                  {f.path.split("/").pop()}{" "}
                  <span className="text-muted">({formatSize(t, f.size)})</span>
                </Checkbox>
              ))}
            </fieldset>
          )}
        </>
      )}
      {run.isPending && (
        <Progress
          label={
            progress?.step === "overrides" || progress?.step === "finish"
              ? t("modpacks.import.unpacking")
              : t("modpacks.import.downloading")
          }
          {...(percent !== undefined && { value: percent })}
        />
      )}
      {run.isError && !cancelled && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, run.error)}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <span className="me-auto text-xs text-muted">
          {t("modpacks.import.gameLater")}
        </span>
        {run.isPending ? (
          <Button
            onClick={() => {
              void invoke("modpacks:cancel", preview.token);
            }}
          >
            {t("modpacks.cancel")}
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!preview.supported || trimmed.length === 0}
            onClick={() => {
              run.mutate();
            }}
          >
            {t("modpacks.import.import")}
          </Button>
        )}
      </div>
    </div>
  );
}

function BackLink({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex w-fit items-center gap-1 text-sm text-muted hover:text-text disabled:opacity-50"
    >
      <ArrowLeft size={16} className="rtl:rotate-180" aria-hidden />
      {t("modpacks.import.back")}
    </button>
  );
}
