import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { File, Folder } from "lucide-react";
import type { ModpackExportOptions, ProfileInfo } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Dialog } from "../ui/Dialog";
import { Input } from "../ui/Input";
import { Progress } from "../ui/Progress";

/** Save a profile as a Modrinth mod pack (`.mrpack`): name it, choose what goes in. */
export function ExportModpackDialog({
  profile,
  onClose,
}: {
  profile: ProfileInfo;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const options = useQuery({
    queryKey: ["modpacks", "exportOptions", profile.id],
    queryFn: () => invoke("modpacks:exportOptions", profile.id),
  });
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t("modpacks.export.title", { name: profile.name })}
      description={t("modpacks.export.body")}
      closeLabel={t("modpacks.cancel")}
    >
      {options.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, options.error)}
        </p>
      )}
      {options.data && (
        <ExportForm
          profile={profile}
          options={options.data}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function ExportForm({
  profile,
  options,
  onClose,
}: {
  profile: ProfileInfo;
  options: ModpackExportOptions;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(options.name);
  const [versionNumber, setVersionNumber] = useState(options.versionNumber);
  const [summary, setSummary] = useState("");
  const [include, setInclude] = useState<ReadonlySet<string>>(
    () =>
      new Set(options.entries.filter((e) => e.suggested).map((e) => e.name)),
  );
  const run = useMutation({
    mutationFn: () =>
      invoke("modpacks:export", {
        profileId: profile.id,
        name: name.trim(),
        versionNumber: versionNumber.trim(),
        ...(summary.trim() && { summary: summary.trim() }),
        include: [...include],
      }),
  });
  const result = run.data;
  const valid = name.trim() !== "" && versionNumber.trim() !== "";

  if (result)
    return (
      <div className="flex flex-col gap-3 text-sm" aria-live="polite">
        <p className="text-success">
          {t("modpacks.export.done", {
            downloads: result.downloads,
            included: result.included,
          })}
        </p>
        {result.unknown.length > 0 && (
          <div className="flex flex-col gap-1 text-warning">
            <p>
              {t("modpacks.export.unknown", { count: result.unknown.length })}
            </p>
            <ul className="ms-4 text-xs text-muted">
              {result.unknown.map((p) => (
                <li key={p} className="break-all">
                  {p}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            {t("modpacks.update.done")}
          </Button>
        </div>
      </div>
    );

  return (
    <form
      className="flex flex-col gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) run.mutate();
      }}
    >
      <fieldset disabled={run.isPending} className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-muted">{t("modpacks.export.name")}</span>
            <Input
              value={name}
              maxLength={256}
              onChange={(e) => {
                setName(e.target.value);
              }}
              className="w-64"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">{t("modpacks.export.version")}</span>
            <Input
              value={versionNumber}
              maxLength={64}
              onChange={(e) => {
                setVersionNumber(e.target.value);
              }}
              className="w-32"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-muted">{t("modpacks.export.summary")}</span>
          <Input
            value={summary}
            maxLength={500}
            onChange={(e) => {
              setSummary(e.target.value);
            }}
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="font-medium">{t("modpacks.export.include")}</span>
          <span className="text-xs text-muted">
            {t("modpacks.export.includeHint")}
          </span>
          <div className="grid max-h-56 grid-cols-2 gap-1 overflow-auto">
            {options.entries.map((e) => (
              <Checkbox
                key={e.name}
                checked={include.has(e.name)}
                onChange={(checked) => {
                  setInclude((s) => {
                    const next = new Set(s);
                    if (checked) next.add(e.name);
                    else next.delete(e.name);
                    return next;
                  });
                }}
              >
                <span className="flex min-w-0 items-center gap-1">
                  {e.folder ? (
                    <Folder
                      size={14}
                      className="shrink-0 text-muted"
                      aria-hidden
                    />
                  ) : (
                    <File
                      size={14}
                      className="shrink-0 text-muted"
                      aria-hidden
                    />
                  )}
                  <span className="truncate">{e.name}</span>
                </span>
              </Checkbox>
            ))}
          </div>
        </div>
      </fieldset>
      {run.isPending && <Progress label={t("modpacks.export.working")} />}
      {run.isError && (
        <p role="alert" className="text-danger">
          {errorMessage(t, run.error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose} disabled={run.isPending}>
          {t("modpacks.cancel")}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={!valid || run.isPending}
        >
          {t("modpacks.export.save")}
        </Button>
      </div>
    </form>
  );
}
