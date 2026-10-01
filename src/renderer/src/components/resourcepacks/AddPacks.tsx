import type { ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AddPacksResult } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { FileDropZone } from "../ui/FileDropZone";

/** Which pack library: resource packs, shader packs or data packs. */
export type PackKind = "resourcePacks" | "shaders" | "dataPacks";

function addZips(
  kind: PackKind,
  paths: string[] | "picker",
  target: { profileId?: string; worldId?: string },
): Promise<AddPacksResult> {
  if (kind === "dataPacks") {
    const world = target.worldId ? { worldId: target.worldId } : {};
    return paths === "picker"
      ? invoke("dataPacks:addFromPicker", world)
      : invoke("dataPacks:addFiles", { paths, ...world });
  }
  if (kind === "shaders")
    return paths === "picker"
      ? invoke("shaders:addFromPicker", target)
      : invoke("shaders:addFiles", { paths, ...target });
  return paths === "picker"
    ? invoke("resourcePacks:addFromPicker", target)
    : invoke("resourcePacks:addFiles", { paths, ...target });
}

/**
 * An area that takes dropped pack `.zip` files, with an add button (file picker).
 * With a profile, added resource packs are also turned on there, at the top, and
 * added shaders are put in it; with a world, added data packs are put in it.
 */
export function AddPacks({
  kind = "resourcePacks",
  profileId,
  worldId,
  actions,
  children,
}: {
  kind?: PackKind;
  profileId?: string;
  /** Data packs only: the world they go into. */
  worldId?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const target = {
    ...(profileId && { profileId }),
    ...(worldId && { worldId }),
  };

  const add = useMutation({
    mutationFn: (paths: string[] | "picker") => addZips(kind, paths, target),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [kind] });
    },
  });
  const result = add.data;
  const nothing =
    result && result.added + result.existing + result.failed.length === 0;

  return (
    <FileDropZone
      accept={/\.zip$/i}
      onAdd={(paths) => {
        add.mutate(paths);
      }}
      pending={add.isPending}
      addLabel={t(`${kind}.add`)}
      dropHint={t(`${kind}.drop`)}
      actions={actions}
      status={
        <>
          {result && !nothing && (
            <p className="text-sm text-muted" aria-live="polite">
              {t(`${kind}.added`, {
                added: result.added,
                existing: result.existing,
              })}
              {result.failed.length > 0 &&
                ` ${t(`${kind}.notAdded`, {
                  files: result.failed
                    .map((f) => `${f.fileName} (${errorMessage(t, f)})`)
                    .join(", "),
                })}`}
            </p>
          )}
          {add.isError && (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(t, add.error)}
            </p>
          )}
        </>
      }
    >
      {children}
    </FileDropZone>
  );
}
