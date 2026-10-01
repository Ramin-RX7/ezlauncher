import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { LibraryPack } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useProfiles } from "../../state/queries";
import { SourceBadge } from "../mods/SourceBadge";
import { FindShadersDialog } from "../shaders/FindShadersDialog";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { AddPacks, type PackKind } from "./AddPacks";
import { FindPacksDialog } from "./FindPacksDialog";
import { PackIcon } from "./PackIcon";

const listOf = (kind: PackKind) =>
  kind === "shaders"
    ? invoke("shaders:library")
    : invoke("resourcePacks:library");
const removeOne = (kind: PackKind, sha1: string) =>
  kind === "shaders"
    ? invoke("shaders:remove", { sha1, force: true })
    : invoke("resourcePacks:remove", { sha1, force: true });
const removeAllUnused = (kind: PackKind) =>
  kind === "shaders"
    ? invoke("shaders:removeUnused")
    : invoke("resourcePacks:removeUnused");

/** Every stored pack of a kind, which profiles have it, and removing packs. */
export function PackLibraryTab({
  kind = "resourcePacks",
}: {
  kind?: PackKind;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const library = useQuery({
    queryKey: [kind, "library"],
    queryFn: () => listOf(kind),
  });
  const profiles = useProfiles();
  const [removing, setRemoving] = useState<LibraryPack>();
  const [confirmUnused, setConfirmUnused] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [finding, setFinding] = useState(false);

  const profileNames = useMemo(
    () => Object.fromEntries((profiles.data ?? []).map((p) => [p.id, p.name])),
    [profiles.data],
  );
  const names = (ids: string[]) =>
    ids.map((id) => profileNames[id] ?? id).join(", ");
  const list = library.data ?? [];
  const unused = list.filter((p) => p.usedBy.length === 0).length;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [kind] });
  };

  const remove = useMutation({
    mutationFn: (sha1: string) => removeOne(kind, sha1),
    onSuccess: () => {
      setRemoving(undefined);
      refresh();
    },
  });
  const removeUnused = useMutation({
    mutationFn: () => removeAllUnused(kind),
    onSuccess: (count) => {
      setConfirmUnused(false);
      setNotice(t(`${kind}.removedUnused`, { count }));
      refresh();
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t(`${kind}.title`)}</h1>
          <p className="text-sm text-muted">{t(`${kind}.libraryHint`)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => {
              setFinding(true);
            }}
          >
            {t(`${kind}.find.open`)}
          </Button>
          <Button
            disabled={unused === 0}
            onClick={() => {
              removeUnused.reset();
              setConfirmUnused(true);
            }}
          >
            {t(`${kind}.removeUnused`)}
          </Button>
        </div>
      </div>
      {finding &&
        (kind === "shaders" ? (
          <FindShadersDialog
            onClose={() => {
              setFinding(false);
            }}
          />
        ) : (
          <FindPacksDialog
            onClose={() => {
              setFinding(false);
            }}
          />
        ))}
      {notice && (
        <p className="text-sm text-muted" aria-live="polite">
          {notice}
        </p>
      )}
      {library.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, library.error)}
        </p>
      )}

      <AddPacks kind={kind}>
        {library.isSuccess && list.length === 0 ? (
          <p className="rounded-ezl border border-dashed border-border p-6 text-center text-sm text-muted">
            {t(`${kind}.empty`)}
          </p>
        ) : (
          <ul className="min-h-0 overflow-auto rounded-ezl border border-border bg-surface">
            {list.map((p) => (
              <li
                key={p.sha1}
                className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
              >
                <PackIcon
                  kind={kind}
                  packRef={{ kind: "library", sha1: p.sha1 }}
                  hasIcon={p.hasIcon}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{p.name}</span>
                    {p.source && (
                      <SourceBadge
                        sourceId={p.source.sourceId}
                        pageUrl={p.source.pageUrl}
                        modName={p.name}
                      />
                    )}
                    {!p.source && !p.checked && (
                      <span className="text-xs text-muted">
                        {t(`${kind}.notChecked`)}
                      </span>
                    )}
                    {p.usedBy.length === 0 && (
                      <span className="rounded-ezl border border-border px-2 py-0.5 text-xs text-muted">
                        {t(`${kind}.unused`)}
                      </span>
                    )}
                  </span>
                  {p.description && (
                    <span className="truncate text-xs text-muted">
                      {p.description}
                    </span>
                  )}
                  {p.usedBy.length > 0 && (
                    <span className="truncate text-xs text-muted">
                      {t(`${kind}.usedBy`, { names: names(p.usedBy) })}
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  className="text-danger"
                  onClick={() => {
                    remove.reset();
                    setRemoving(p);
                  }}
                >
                  {t(`${kind}.remove`)}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </AddPacks>

      {removing && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setRemoving(undefined);
          }}
          title={t(`${kind}.removeTitle`, { name: removing.name })}
          description={t(`${kind}.removeBody`)}
          closeLabel={t(`${kind}.cancel`)}
          footer={
            <>
              <Button
                onClick={() => {
                  setRemoving(undefined);
                }}
              >
                {t(`${kind}.cancel`)}
              </Button>
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate(removing.sha1);
                }}
              >
                {t(`${kind}.removeConfirm`)}
              </Button>
            </>
          }
        >
          {removing.usedBy.length > 0 && (
            <p className="text-sm text-warning">
              {t(`${kind}.removeUsed`, { names: names(removing.usedBy) })}
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
          title={t(`${kind}.removeUnusedTitle`, { count: unused })}
          description={t(`${kind}.removeUnusedBody`)}
          closeLabel={t(`${kind}.cancel`)}
          footer={
            <>
              <Button
                onClick={() => {
                  setConfirmUnused(false);
                }}
              >
                {t(`${kind}.cancel`)}
              </Button>
              <Button
                variant="danger"
                disabled={removeUnused.isPending}
                onClick={() => {
                  removeUnused.mutate();
                }}
              >
                {t(`${kind}.removeUnused`)}
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
