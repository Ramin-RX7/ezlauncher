import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { LibraryMod } from "@shared/launcher";
import { AddMods } from "../components/mods/AddMods";
import { loaderLabel } from "../components/mods/compatText";
import { ModIcon } from "../components/mods/ModIcon";
import { SourceBadge } from "../components/mods/SourceBadge";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { invoke } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { useProfiles } from "../state/queries";

/** Every stored mod, which profiles use it, and removing mods. */
export function ModLibraryPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const library = useQuery({
    queryKey: ["mods", "library"],
    queryFn: () => invoke("mods:library", {}),
  });
  const profiles = useProfiles();
  const [removing, setRemoving] = useState<LibraryMod>();
  const [confirmUnused, setConfirmUnused] = useState(false);
  const [notice, setNotice] = useState<string>();

  const profileNames = useMemo(
    () => Object.fromEntries((profiles.data ?? []).map((p) => [p.id, p.name])),
    [profiles.data],
  );
  const names = (ids: string[]) =>
    ids.map((id) => profileNames[id] ?? id).join(", ");
  const list = library.data ?? [];
  const unused = list.filter((m) => m.usedBy.length === 0).length;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["mods"] });
  };

  const remove = useMutation({
    mutationFn: (sha1: string) => invoke("mods:remove", { sha1, force: true }),
    onSuccess: () => {
      setRemoving(undefined);
      refresh();
    },
  });
  const removeUnused = useMutation({
    mutationFn: () => invoke("mods:removeUnused"),
    onSuccess: (count) => {
      setConfirmUnused(false);
      setNotice(t("mods.removedUnused", { count }));
      refresh();
    },
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("mods.title")}</h1>
          <p className="text-sm text-muted">{t("mods.libraryHint")}</p>
        </div>
        <Button
          disabled={unused === 0}
          onClick={() => {
            removeUnused.reset();
            setConfirmUnused(true);
          }}
        >
          {t("mods.removeUnused")}
        </Button>
      </div>
      {notice && (
        <p className="text-sm text-muted" aria-live="polite">
          {notice}
        </p>
      )}

      <AddMods>
        {library.isSuccess && list.length === 0 ? (
          <p className="rounded-ezl border border-dashed border-border p-6 text-center text-sm text-muted">
            {t("mods.empty")}
          </p>
        ) : (
          <ul className="min-h-0 overflow-auto rounded-ezl border border-border bg-surface">
            {list.map((m) => (
              <li
                key={m.sha1}
                className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
              >
                <ModIcon mod={m} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{m.name}</span>
                    {m.source && (
                      <SourceBadge
                        sourceId={m.source.sourceId}
                        pageUrl={m.source.pageUrl}
                        modName={m.name}
                      />
                    )}
                    {!m.source && !m.checked && (
                      <span className="text-xs text-muted">
                        {t("mods.notChecked")}
                      </span>
                    )}
                    {m.usedBy.length === 0 && (
                      <span className="rounded-ezl border border-border px-2 py-0.5 text-xs text-muted">
                        {t("mods.unused")}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-xs text-muted">
                    {[
                      m.version
                        ? t("mods.version", { version: m.version })
                        : t("mods.unknownVersion"),
                      m.loaders.map((l) => loaderLabel(t, l)).join(" / "),
                      m.mcVersionRange,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {m.usedBy.length > 0 && (
                    <span className="truncate text-xs text-muted">
                      {t("mods.usedBy", { names: names(m.usedBy) })}
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  className="text-danger"
                  onClick={() => {
                    remove.reset();
                    setRemoving(m);
                  }}
                >
                  {t("mods.remove")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </AddMods>

      {removing && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setRemoving(undefined);
          }}
          title={t("mods.removeTitle", { name: removing.name })}
          description={t("mods.removeBody")}
          closeLabel={t("mods.cancel")}
          footer={
            <>
              <Button
                onClick={() => {
                  setRemoving(undefined);
                }}
              >
                {t("mods.cancel")}
              </Button>
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate(removing.sha1);
                }}
              >
                {t("mods.removeConfirm")}
              </Button>
            </>
          }
        >
          {removing.usedBy.length > 0 && (
            <p className="text-sm text-warning">
              {t("mods.removeUsed", { names: names(removing.usedBy) })}
            </p>
          )}
          {remove.isError && (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(t, remove.error)}
            </p>
          )}
        </Dialog>
      )}

      {confirmUnused && (
        <Dialog
          open
          onOpenChange={setConfirmUnused}
          title={t("mods.removeUnusedTitle", { count: unused })}
          description={t("mods.removeUnusedBody")}
          closeLabel={t("mods.cancel")}
          footer={
            <>
              <Button
                onClick={() => {
                  setConfirmUnused(false);
                }}
              >
                {t("mods.cancel")}
              </Button>
              <Button
                variant="danger"
                disabled={removeUnused.isPending}
                onClick={() => {
                  removeUnused.mutate();
                }}
              >
                {t("mods.removeUnused")}
              </Button>
            </>
          }
        >
          {removeUnused.isError && (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(t, removeUnused.error)}
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}
