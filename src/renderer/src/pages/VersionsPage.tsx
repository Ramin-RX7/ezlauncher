import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, ScrollText, Search } from "lucide-react";
import type { InstalledVersionInfo } from "@shared/launcher";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Input } from "../components/ui/Input";
import { ChangelogDialog } from "../components/versions/ChangelogDialog";
import { ContextMenuArea, Menu, type MenuItem } from "../components/ui/Menu";
import { InstallProgressRow } from "../components/play/InstallProgressRow";
import { invoke } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { useLauncherState } from "../state/launcherStore";
import { keys, useLoaders, useProfiles } from "../state/queries";

/** Installed versions: which profiles use them, Repair and Delete. */
export function VersionsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const installed = useQuery({
    queryKey: keys.installed,
    queryFn: () => invoke("versions:installed"),
  });
  const profiles = useProfiles();
  const loaders = useLoaders();
  const installs = useLauncherState((s) => s.installs);
  const running = useLauncherState((s) => s.running);
  const [deleting, setDeleting] = useState<InstalledVersionInfo>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [notesFor, setNotesFor] = useState<string>();

  const profileNames = useMemo(
    () => Object.fromEntries((profiles.data ?? []).map((p) => [p.id, p.name])),
    [profiles.data],
  );
  const names = (ids: string[]) =>
    ids.map((id) => profileNames[id] ?? id).join(", ");
  const loaderName = (id: string) =>
    loaders.data?.find((l) => l.id === id)?.displayName ?? id;

  const remove = useMutation({
    mutationFn: (versionId: string) =>
      invoke("versions:delete", { versionId, force: true }),
    onSuccess: () => {
      setDeleting(undefined);
      void queryClient.invalidateQueries({ queryKey: keys.versions });
      void queryClient.invalidateQueries({ queryKey: keys.profiles });
    },
  });

  const list = installed.data ?? [];
  // Search by version, loader or the profiles that use it.
  const q = query.trim().toLowerCase();
  const shown = q
    ? list.filter((v) =>
        [
          v.id,
          v.loader?.gameVersion,
          v.loader && loaderName(v.loader.id),
          names(v.usedBy),
        ].some((text) => text?.toLowerCase().includes(q)),
      )
    : list;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{t("versionsPage.title")}</h1>
        {list.length > 0 && (
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute start-2.5 top-2.5 text-muted"
            />
            <Input
              type="search"
              aria-label={t("versionsPage.search")}
              placeholder={t("versionsPage.search")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              className="w-64 ps-8"
            />
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {installed.isSuccess && list.length === 0 && (
        <p className="rounded-ezl border border-border bg-surface p-6 text-center text-sm text-muted">
          {t("versionsPage.empty")}
        </p>
      )}
      {list.length > 0 && shown.length === 0 && (
        <p className="rounded-ezl border border-border bg-surface p-6 text-center text-sm text-muted">
          {t("versionsPage.noMatch")}
        </p>
      )}
      {shown.length > 0 && (
        <ul className="overflow-hidden rounded-ezl border border-border bg-surface">
          {shown.map((v) => {
            const install = installs[v.id];
            // A running game uses it, directly or through a loader install built on it.
            const played = running.some(
              (g) =>
                g.versionId === v.id ||
                list.find((x) => x.id === g.versionId)?.loader?.gameVersion ===
                  v.id,
            );
            const installing =
              install?.status === "queued" || install?.status === "running";
            const busy = played || installing;
            const mcVersion = v.loader?.gameVersion ?? v.id;
            const items: MenuItem[] = [
              {
                label: t("versions.changelog.menu"),
                onSelect: () => {
                  setNotesFor(mcVersion);
                },
              },
              {
                label: t("versionsPage.repair"),
                disabled: busy,
                onSelect: () => {
                  setError(undefined);
                  invoke("versions:repair", v.id).catch((err: unknown) => {
                    setError(errorMessage(t, err));
                  });
                },
              },
              {
                label: t("versionsPage.delete"),
                danger: true,
                disabled: busy,
                onSelect: () => {
                  remove.reset();
                  setDeleting(v);
                },
              },
            ];
            return (
              <ContextMenuArea key={v.id} items={items}>
                <li className="flex flex-col gap-2 border-b border-border px-3 py-3 last:border-b-0">
                  <div className="flex items-center gap-3">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium">
                          {v.loader?.gameVersion ?? v.id}
                        </span>
                        {v.loader && (
                          <span className="rounded-ezl border border-border px-2 py-0.5 text-xs text-muted">
                            {t("loaders.badge", {
                              name: loaderName(v.loader.id),
                              version: v.loader.loaderVersion,
                            })}
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted">
                        {v.usedBy.length > 0
                          ? t("versionsPage.usedBy", { names: names(v.usedBy) })
                          : t("versionsPage.unused")}
                        {played && ` · ${t("versionsPage.inUse")}`}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={t("versions.changelog.open", {
                        id: mcVersion,
                      })}
                      title={t("versions.changelog.open", { id: mcVersion })}
                      onClick={() => {
                        setNotesFor(mcVersion);
                      }}
                      className="rounded-ezl p-1.5 text-muted hover:bg-bg hover:text-text"
                    >
                      <ScrollText size={16} aria-hidden />
                    </button>
                    <Menu
                      trigger={
                        <button
                          type="button"
                          aria-label={t("versionsPage.menu", { id: v.id })}
                          className="rounded-ezl p-1.5 text-muted hover:bg-bg hover:text-text"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      }
                      items={items}
                    />
                  </div>
                  {installing && (
                    <InstallProgressRow
                      versionId={v.id}
                      progress={install.progress}
                    />
                  )}
                </li>
              </ContextMenuArea>
            );
          })}
        </ul>
      )}

      {deleting && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(undefined);
          }}
          title={t("versionsPage.deleteTitle", { id: deleting.id })}
          description={t("versionsPage.deleteBody")}
          closeLabel={t("versionsPage.cancel")}
          footer={
            <>
              <Button
                onClick={() => {
                  setDeleting(undefined);
                }}
              >
                {t("versionsPage.cancel")}
              </Button>
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate(deleting.id);
                }}
              >
                {t("versionsPage.deleteConfirm")}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-2 text-sm">
            {deleting.usedBy.length > 0 && (
              <p className="text-warning">
                {t("versionsPage.inUse", { names: names(deleting.usedBy) })}
              </p>
            )}
            {deleting.dependents.length > 0 && (
              <p className="text-warning">
                {t("versionsPage.dependents", {
                  ids: deleting.dependents.join(", "),
                })}
              </p>
            )}
            {remove.isError && (
              <p role="alert" className="text-danger">
                {errorMessage(t, remove.error)}
              </p>
            )}
          </div>
        </Dialog>
      )}
      {notesFor && (
        <ChangelogDialog
          versionId={notesFor}
          onClose={() => {
            setNotesFor(undefined);
          }}
        />
      )}
    </div>
  );
}
