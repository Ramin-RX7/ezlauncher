import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import type { VersionListResult } from "@shared/launcher";
import { GameLog } from "../components/play/GameLog";
import { PlayBar } from "../components/play/PlayBar";
import { Button } from "../components/ui/Button";
import { Checkbox } from "../components/ui/Checkbox";
import { Dialog } from "../components/ui/Dialog";
import { VersionList } from "../components/versions/VersionList";
import { invoke } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { useLauncherState } from "../state/launcherStore";

const SELECTED_KEY = "ezlauncher.selectedVersion";

function loadSelected(): string | undefined {
  try {
    return localStorage.getItem(SELECTED_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function HomePage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ["versions"],
    queryFn: () => invoke("versions:list", {}),
  });

  const [notice, setNotice] = useState<string>();
  const refresh = useMutation({
    mutationFn: () => invoke("versions:list", { refresh: true }),
    onSuccess: (result) => {
      const before = new Set(list.data?.versions.map((v) => v.id));
      queryClient.setQueryData<VersionListResult>(["versions"], result);
      if (result.refreshError) {
        setNotice(t("versions.offlineRefresh"));
        return;
      }
      const added =
        before.size === 0
          ? 0
          : result.versions.filter((v) => !before.has(v.id)).length;
      setNotice(
        added > 0
          ? t("versions.newFound", { count: added })
          : t("versions.upToDate"),
      );
    },
  });

  const [selectedId, setSelectedId] = useState<string | undefined>(
    loadSelected,
  );
  const select = (id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem(SELECTED_KEY, id);
    } catch {
      // storage unavailable
    }
  };
  const versions = useMemo(() => list.data?.versions ?? [], [list.data]);
  const selected =
    versions.find((v) => v.id === selectedId) ??
    versions.find((v) => v.id === list.data?.latest?.release) ??
    versions[0];

  // The log opens by itself while a game runs or after a crash, until the user toggles it.
  const [logChoice, setLogChoice] = useState<boolean>();
  const autoOpen = useLauncherState(
    (s) => s.running.length > 0 || s.lastExit?.crashed === true,
  );
  const logOpen = logChoice ?? autoOpen;

  const [deleting, setDeleting] = useState<string>();
  const [deleteWorlds, setDeleteWorlds] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const onActionError = (err: unknown) => {
    setActionError(errorMessage(t, err));
  };
  const remove = useMutation({
    mutationFn: (args: { versionId: string; deleteGameDir: boolean }) =>
      invoke("versions:delete", args),
    onSuccess: () => {
      setDeleting(undefined);
      void queryClient.invalidateQueries({ queryKey: ["versions"] });
    },
    onError: onActionError,
  });

  const fetchedAt = list.data?.fetchedAt
    ? new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(list.data.fetchedAt))
    : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted" aria-live="polite">
          {notice ?? (fetchedAt && t("versions.listFrom", { date: fetchedAt }))}
        </p>
        <Button
          variant="secondary"
          disabled={refresh.isPending || list.isPending}
          onClick={() => {
            setNotice(undefined);
            refresh.mutate();
          }}
        >
          <RefreshCw
            size={16}
            className={refresh.isPending ? "animate-spin" : ""}
            aria-hidden
          />
          {refresh.isPending ? t("versions.checking") : t("versions.check")}
        </Button>
      </div>

      {list.isPending && (
        <p className="text-sm text-muted">{t("versions.loading")}</p>
      )}
      {list.data?.source === "none" && list.data.versions.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-ezl border border-border bg-surface p-8 text-center">
          <p className="text-sm text-muted">{t("versions.noList")}</p>
          <Button
            variant="primary"
            disabled={refresh.isPending}
            onClick={() => {
              refresh.mutate();
            }}
          >
            {t("versions.tryAgain")}
          </Button>
        </div>
      )}
      {list.isError && (
        <p className="text-sm text-danger">{errorMessage(t, list.error)}</p>
      )}
      {actionError && (
        <p role="alert" className="text-sm text-danger">
          {actionError}
        </p>
      )}

      {versions.length > 0 && (
        <VersionList
          versions={versions}
          selectedId={selected?.id}
          onSelect={select}
          onRepair={(id) => {
            setActionError(undefined);
            select(id); // its progress shows in the play bar
            invoke("versions:repair", id).catch(onActionError);
          }}
          onOpenFolder={(id) => {
            invoke("versions:openGameDir", id).catch(onActionError);
          }}
          onDelete={(id) => {
            setDeleteWorlds(false);
            setActionError(undefined);
            setDeleting(id);
          }}
        />
      )}

      <PlayBar version={selected} />
      <GameLog
        open={logOpen}
        onToggle={() => {
          setLogChoice(!logOpen);
        }}
      />

      <Dialog
        open={deleting !== undefined}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        title={t("versions.deleteTitle", { id: deleting ?? "" })}
        description={t("versions.deleteBody")}
        closeLabel={t("versions.cancel")}
        footer={
          <>
            <Button
              onClick={() => {
                setDeleting(undefined);
              }}
            >
              {t("versions.cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() => {
                if (deleting)
                  remove.mutate({
                    versionId: deleting,
                    deleteGameDir: deleteWorlds,
                  });
              }}
            >
              {t("versions.deleteConfirm")}
            </Button>
          </>
        }
      >
        <Checkbox checked={deleteWorlds} onChange={setDeleteWorlds}>
          {t("versions.deleteWorlds")}
        </Checkbox>
      </Dialog>
    </div>
  );
}
