import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";
import type {
  ModpackProgress,
  ModpackUpdateAction,
  ModpackUpdatePlan,
  ProfileInfo,
} from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useIpcEvent } from "../../lib/useIpcEvent";
import { keys } from "../../state/queries";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Dialog } from "../ui/Dialog";
import { Progress } from "../ui/Progress";
import { Select } from "../ui/Select";
import { isSupportedPack, loaderLabel } from "./modpackText";

/** The groups an update's changes are shown in. */
const GROUPS: readonly ModpackUpdateAction[] = [
  "add",
  "update",
  "remove",
  "keepRemoved",
];

/**
 * Update a mod pack profile to another version of its pack (from its site, or a
 * pack file): see what changes, choose which of your changed files to replace, apply.
 */
export function UpdateModpackDialog({
  profile,
  onClose,
}: {
  profile: ProfileInfo;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fromSite = Boolean(
    profile.modpack?.sourceId && profile.modpack.projectId,
  );
  const versions = useQuery({
    queryKey: ["modpacks", "updateVersions", profile.id],
    queryFn: () => invoke("modpacks:updateVersions", profile.id),
    enabled: fromSite,
  });
  const list = versions.data ?? [];
  const current = profile.modpack?.versionId;
  const [picked, setPicked] = useState<string>();
  const versionId =
    picked ?? list.find((v) => isSupportedPack(v.loaders))?.versionId;
  const [plan, setPlan] = useState<ModpackUpdatePlan>();
  const [replace, setReplace] = useState<ReadonlySet<string>>(new Set());
  const [progress, setProgress] = useState<ModpackProgress>();
  const jobToken = plan?.token ?? versionId;
  useIpcEvent("modpacks:progress", (p) => {
    if (p.token === jobToken) setProgress(p);
  });

  const check = useMutation({
    mutationFn: async (from: "site" | "file") => {
      if (from === "site")
        return invoke("modpacks:planUpdate", {
          profileId: profile.id,
          ...(versionId && { versionId }),
        });
      const file = await invoke("modpacks:pickFile");
      if (!file) return undefined;
      return invoke("modpacks:planUpdate", {
        profileId: profile.id,
        token: file.token,
      });
    },
    onMutate: () => {
      setProgress(undefined);
    },
    onSuccess: (result) => {
      if (result) setPlan(result);
    },
  });
  const apply = useMutation({
    mutationFn: (token: string) =>
      invoke("modpacks:applyUpdate", { token, replace: [...replace] }),
    onMutate: () => {
      setProgress(undefined);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.profiles });
      void queryClient.invalidateQueries({ queryKey: ["mods"] });
    },
  });
  const busy = check.isPending || apply.isPending;
  const cancelledCheck =
    (check.error as { code?: string } | null)?.code === "CANCELLED";

  const close = () => {
    if (busy) return;
    if (plan && !apply.isSuccess)
      void invoke("modpacks:discardUpdate", plan.token);
    onClose();
  };

  const result = apply.data;
  const items = plan?.items ?? [];
  const changed = items.filter((i) => i.action === "changed");
  const percent =
    progress && progress.totalBytes > 0
      ? (progress.bytes / progress.totalBytes) * 100
      : undefined;

  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => {
        if (!o) close();
      }}
      title={t("modpacks.update.title", { name: profile.name })}
      closeLabel={t("modpacks.cancel")}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            {t("modpacks.update.done")}
          </Button>
        ) : busy ? (
          <Button
            onClick={() => {
              if (jobToken) void invoke("modpacks:cancel", jobToken);
            }}
            disabled={apply.isPending}
          >
            {t("modpacks.cancel")}
          </Button>
        ) : plan ? (
          <>
            <Button onClick={close}>{t("modpacks.cancel")}</Button>
            <Button
              variant="primary"
              disabled={!plan.supported}
              onClick={() => {
                apply.mutate(plan.token);
              }}
            >
              {t("modpacks.update.apply")}
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={() => {
                check.mutate("file");
              }}
            >
              {t("modpacks.update.fromFile")}
            </Button>
            {fromSite && (
              <Button
                variant="primary"
                disabled={!versionId}
                onClick={() => {
                  check.mutate("site");
                }}
              >
                {t("modpacks.update.check")}
              </Button>
            )}
          </>
        )
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {result ? (
          <div className="flex flex-col gap-1" aria-live="polite">
            <p className="text-success">
              {t("modpacks.update.result", {
                added: result.added,
                updated: result.updated,
                removed: result.removed,
              })}
            </p>
            {result.backup && (
              <p className="text-xs break-all text-muted">
                {t("modpacks.update.backupAt", { path: result.backup })}
              </p>
            )}
          </div>
        ) : plan ? (
          <>
            <p>
              {t("modpacks.update.fromTo", { from: plan.from, to: plan.to })}
            </p>
            {(plan.gameVersion.from !== plan.gameVersion.to ||
              plan.loader.from !== plan.loader.to) && (
              <p className="flex items-center gap-2 text-warning">
                <TriangleAlert size={16} aria-hidden />
                {t("modpacks.update.versionChange", {
                  from: [
                    plan.gameVersion.from,
                    plan.loader.from && loaderLabel(t, plan.loader.from),
                  ]
                    .filter(Boolean)
                    .join(" "),
                  to: [
                    plan.gameVersion.to,
                    plan.loader.to && loaderLabel(t, plan.loader.to),
                  ]
                    .filter(Boolean)
                    .join(" "),
                })}
              </p>
            )}
            {!plan.supported && (
              <p role="alert" className="text-danger">
                {t("modpacks.needsLoader", {
                  loader: loaderLabel(t, plan.loader.to ?? ""),
                })}
              </p>
            )}
            {items.length === 0 && (
              <p className="text-muted">{t("modpacks.update.nothing")}</p>
            )}
            <div className="flex max-h-[45vh] flex-col gap-3 overflow-auto">
              {GROUPS.map((action) => {
                const group = items.filter((i) => i.action === action);
                if (group.length === 0) return null;
                return (
                  <details key={action} open={group.length <= 8}>
                    <summary className="cursor-pointer font-medium">
                      {t(`modpacks.update.groups.${action}`, {
                        count: group.length,
                      })}
                    </summary>
                    <ul className="ms-4 mt-1 flex flex-col gap-0.5 text-xs text-muted">
                      {group.map((i) => (
                        <li key={i.path} className="break-all">
                          {i.path}
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })}
              {changed.length > 0 && (
                <fieldset disabled={busy} className="flex flex-col gap-1">
                  <legend className="font-medium">
                    {t("modpacks.update.groups.changed", {
                      count: changed.length,
                    })}
                  </legend>
                  <p className="text-xs text-muted">
                    {t("modpacks.update.changedHint")}
                  </p>
                  {changed.map((i) => (
                    <Checkbox
                      key={i.path}
                      checked={replace.has(i.path)}
                      onChange={(checked) => {
                        setReplace((s) => {
                          const next = new Set(s);
                          if (checked) next.add(i.path);
                          else next.delete(i.path);
                          return next;
                        });
                      }}
                    >
                      <span className="break-all">
                        {t("modpacks.update.replaceMine", { path: i.path })}
                      </span>
                    </Checkbox>
                  ))}
                </fieldset>
              )}
            </div>
            <p className="text-xs text-muted">{t("modpacks.update.safety")}</p>
          </>
        ) : (
          <>
            <p className="text-muted">
              {t("modpacks.update.current", {
                version: profile.modpack?.versionNumber ?? "",
              })}
            </p>
            {!fromSite && (
              <p className="text-muted">{t("modpacks.update.noSite")}</p>
            )}
            {versions.isError && (
              <p role="alert" className="text-danger">
                {errorMessage(t, versions.error)}
              </p>
            )}
            {list.length > 0 && (
              <label className="flex flex-col gap-1">
                <span className="text-muted">
                  {t("modpacks.import.version")}
                </span>
                <Select
                  aria-label={t("modpacks.import.version")}
                  value={versionId ?? ""}
                  disabled={busy}
                  onChange={setPicked}
                  options={list.map((v) => {
                    const label = [
                      v.versionNumber,
                      v.gameVersions.join(", "),
                      v.versionId === current && t("modpacks.update.installed"),
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    const ok = isSupportedPack(v.loaders);
                    return {
                      value: v.versionId,
                      label: ok
                        ? label
                        : t("modpacks.unsupportedVersion", { label }),
                      disabled: !ok,
                    };
                  })}
                />
              </label>
            )}
          </>
        )}
        {busy && (
          <Progress
            label={
              apply.isPending
                ? t("modpacks.update.applying")
                : t("modpacks.update.checking")
            }
            {...(percent !== undefined && { value: percent })}
          />
        )}
        {check.isError && !cancelledCheck && (
          <p role="alert" className="text-danger">
            {errorMessage(t, check.error)}
          </p>
        )}
        {apply.isError && (
          <p role="alert" className="text-danger">
            {errorMessage(t, apply.error)}
          </p>
        )}
      </div>
    </Dialog>
  );
}
