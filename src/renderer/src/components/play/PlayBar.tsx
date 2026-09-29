import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Play, X } from "lucide-react";
import { USERNAME_PATTERN, type VersionSummary } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { launcherStore, useLauncherState } from "../../state/launcherStore";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Progress } from "../ui/Progress";

const MB = 1024 * 1024;

export function PlayBar({ version }: { version: VersionSummary | undefined }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const account = useQuery({
    queryKey: ["account"],
    queryFn: () => invoke("account:get"),
  });
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const username = draft ?? account.data?.username ?? "";
  const validName = USERNAME_PATTERN.test(username.trim());

  const install = useLauncherState((s) =>
    version ? s.installs[version.id] : undefined,
  );
  const running = useLauncherState((s) =>
    s.running.some((g) => g.versionId === version?.id),
  );
  const lastExit = useLauncherState((s) => s.lastExit);
  const installing =
    install?.status === "queued" || install?.status === "running";

  const play = useMutation({
    mutationFn: async (versionId: string) => {
      const name = username.trim();
      if (name !== account.data?.username) {
        const saved = await invoke("account:setUsername", name);
        queryClient.setQueryData(["account"], saved);
        setDraft(undefined);
      }
      launcherStore.dismissExit();
      return invoke("game:launch", versionId);
    },
  });

  const busy = installing || play.isPending;
  let label = version?.installed ? t("play.play") : t("play.installAndPlay");
  if (installing) label = t("play.installing");
  else if (play.isPending) label = t("play.starting");
  else if (running) label = t("play.running");

  const p = install?.progress;
  const percent =
    p && p.totalBytes > 0
      ? (p.bytes / p.totalBytes) * 100
      : p && p.totalFiles > 0
        ? (p.files / p.totalFiles) * 100
        : undefined;

  return (
    <section className="flex flex-col gap-3 rounded-ezl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">{t("play.username")}</span>
          <Input
            value={username}
            placeholder={t("play.usernamePlaceholder")}
            maxLength={16}
            aria-invalid={username.length > 0 && !validName}
            aria-describedby="username-rule"
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            className="w-52"
          />
        </label>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted">
            {version ? typeLabel(t, version.type) : "\u00a0"}
          </div>
          <div className="truncate text-lg font-semibold">
            {version?.id ?? t("play.noVersion")}
          </div>
        </div>
        <Button
          variant="primary"
          className="h-11 min-w-44 text-base"
          disabled={!version || !validName || busy || running}
          onClick={() => {
            if (version) play.mutate(version.id);
          }}
        >
          <Play size={18} aria-hidden />
          {label}
        </Button>
      </div>

      <p
        id="username-rule"
        className={`text-xs ${username.length > 0 && !validName ? "text-danger" : "text-muted"}`}
      >
        {t("play.usernameRule")}
      </p>

      {installing && version && (
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex justify-between gap-2 text-xs text-muted">
              <span>
                {p ? t(`play.steps.${p.step}`) : t("play.installing")}
              </span>
              {p && p.totalFiles > 0 && (
                <span>
                  {t("play.progress", {
                    files: p.files,
                    totalFiles: p.totalFiles,
                    mb: (p.bytes / MB).toFixed(1),
                    totalMb: (p.totalBytes / MB).toFixed(1),
                  })}
                </span>
              )}
            </div>
            <Progress value={percent} label={t("play.installing")} />
          </div>
          <Button
            variant="ghost"
            aria-label={t("play.cancel")}
            onClick={() => {
              void invoke("versions:cancel", version.id);
            }}
          >
            <X size={16} aria-hidden />
            {t("play.cancel")}
          </Button>
        </div>
      )}

      {play.isError && !isCancelled(play.error) && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, play.error)}
        </p>
      )}
      {lastExit?.crashed && (
        <p role="alert" className="text-sm text-danger">
          {t("play.crashed", {
            id: lastExit.versionId,
            code: String(lastExit.code),
          })}
        </p>
      )}
    </section>
  );
}

const TYPES = ["release", "snapshot", "old_beta", "old_alpha"] as const;

function typeLabel(t: TFunction, type: string): string {
  const known = TYPES.find((k) => k === type);
  return known ? t(`versions.types.${known}`) : type;
}

function isCancelled(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "CANCELLED"
  );
}
