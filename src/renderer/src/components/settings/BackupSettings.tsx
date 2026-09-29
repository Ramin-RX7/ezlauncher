import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  BackupAuto,
  BackupWhen,
  LauncherSettings,
} from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { formatSize } from "../../lib/formatSize";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Input } from "../ui/Input";
import { RadioGroup } from "../ui/RadioGroup";

type BackupPatch = Partial<
  Pick<
    LauncherSettings,
    | "backupAuto"
    | "backupWhen"
    | "backupIntervalDays"
    | "backupKeepCount"
    | "backupKeepDays"
  >
>;

/** A whole number field saved when it's valid and loses focus (or on Enter). */
function NumberField({
  value,
  min,
  max,
  label,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const n = Number(text);
  const valid = Number.isInteger(n) && n >= min && n <= max;
  const commit = () => {
    if (valid && n !== value) onCommit(n);
    else if (!valid) setText(String(value));
  };
  return (
    <Input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={text}
      aria-label={label}
      aria-invalid={!valid}
      onChange={(e) => {
        setText(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
      className="w-24"
    />
  );
}

/** Settings → Backups: automatic backups, retention, and the backups on disk. */
export function BackupSettings({
  settings,
  onChange,
}: {
  settings: LauncherSettings;
  onChange: (patch: BackupPatch) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const summary = useQuery({
    queryKey: ["backups", "summary"],
    queryFn: () => invoke("backups:summary"),
  });
  const [notice, setNotice] = useState<string>();
  const deleteOrphans = useMutation({
    mutationFn: () => invoke("backups:deleteOrphans"),
    onSuccess: (count) => {
      setNotice(t("settings.backups.orphansDeleted", { count }));
      void queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
  });
  const openFolder = useMutation({
    mutationFn: () => invoke("backups:openFolder"),
  });
  const s = settings;
  const orphans = summary.data?.orphans;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span id="backup-auto-label" className="text-sm font-medium">
          {t("settings.backups.auto")}
        </span>
        <RadioGroup<BackupAuto>
          labelledBy="backup-auto-label"
          value={s.backupAuto}
          onChange={(v) => {
            onChange({ backupAuto: v });
          }}
          options={[
            { value: "off", label: t("settings.backups.off") },
            { value: "launch", label: t("settings.backups.launch") },
            { value: "interval", label: t("settings.backups.interval") },
          ]}
        />
        {s.backupAuto === "interval" && (
          <label className="flex items-center gap-2 ps-6 text-sm">
            {t("settings.backups.intervalDays")}
            <NumberField
              key={s.backupIntervalDays}
              value={s.backupIntervalDays}
              min={1}
              max={365}
              label={t("settings.backups.intervalDays")}
              onCommit={(n) => {
                onChange({ backupIntervalDays: n });
              }}
            />
            {t("settings.backups.days")}
          </label>
        )}
      </div>

      {s.backupAuto !== "off" && (
        <div className="flex flex-col gap-2">
          <span id="backup-when-label" className="text-sm font-medium">
            {t("settings.backups.when")}
          </span>
          <RadioGroup<BackupWhen>
            labelledBy="backup-when-label"
            value={s.backupWhen}
            onChange={(v) => {
              onChange({ backupWhen: v });
            }}
            options={[
              {
                value: "afterExit",
                label: t("settings.backups.afterExit"),
              },
              {
                value: "beforeStart",
                label: t("settings.backups.beforeStart"),
              },
            ]}
          />
        </div>
      )}

      <div className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Checkbox
            checked={s.backupKeepCount !== null}
            onChange={(on) => {
              onChange({ backupKeepCount: on ? 10 : null });
            }}
          >
            {t("settings.backups.keepCount")}
          </Checkbox>
          {s.backupKeepCount !== null && (
            <>
              <NumberField
                key={s.backupKeepCount}
                value={s.backupKeepCount}
                min={1}
                max={100}
                label={t("settings.backups.keepCount")}
                onCommit={(n) => {
                  onChange({ backupKeepCount: n });
                }}
              />
              {t("settings.backups.perWorld")}
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Checkbox
            checked={s.backupKeepDays !== null}
            onChange={(on) => {
              onChange({ backupKeepDays: on ? 30 : null });
            }}
          >
            {t("settings.backups.keepDays")}
          </Checkbox>
          {s.backupKeepDays !== null && (
            <>
              <NumberField
                key={s.backupKeepDays}
                value={s.backupKeepDays}
                min={1}
                max={3650}
                label={t("settings.backups.keepDays")}
                onCommit={(n) => {
                  onChange({ backupKeepDays: n });
                }}
              />
              {t("settings.backups.days")}
            </>
          )}
        </div>
        <p className="text-xs text-muted">
          {t("settings.backups.newestKept")}{" "}
          {t("settings.backups.unchangedHint")}
        </p>
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          {summary.data && (
            <span>
              {t("settings.backups.total", {
                count: summary.data.count,
                size: formatSize(t, summary.data.totalBytes),
              })}
            </span>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              openFolder.mutate();
            }}
          >
            {t("settings.backups.open")}
          </Button>
        </div>
        {orphans && orphans.count > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted">
              {t("settings.backups.orphans", {
                worlds: orphans.worlds,
                count: orphans.count,
                size: formatSize(t, orphans.totalBytes),
              })}
            </span>
            <Button
              variant="ghost"
              className="text-danger"
              disabled={deleteOrphans.isPending}
              onClick={() => {
                setNotice(undefined);
                deleteOrphans.mutate();
              }}
            >
              {t("settings.backups.deleteOrphans")}
            </Button>
          </div>
        )}
        {notice && (
          <p className="text-muted" aria-live="polite">
            {notice}
          </p>
        )}
        {(deleteOrphans.error ?? openFolder.error) && (
          <p role="alert" className="text-danger">
            {errorMessage(t, deleteOrphans.error ?? openFolder.error)}
          </p>
        )}
      </div>
    </div>
  );
}
