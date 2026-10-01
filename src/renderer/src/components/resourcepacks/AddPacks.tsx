import type { ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AddPacksResult } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { FileDropZone } from "../ui/FileDropZone";

/**
 * An area that takes dropped resource pack `.zip` files, with an add button (file
 * picker). With a profile, added packs are also turned on there, at the top.
 */
export function AddPacks({
  profileId,
  actions,
  children,
}: {
  profileId?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const target = profileId ? { profileId } : {};

  const add = useMutation({
    mutationFn: (paths: string[] | "picker"): Promise<AddPacksResult> =>
      paths === "picker"
        ? invoke("resourcePacks:addFromPicker", target)
        : invoke("resourcePacks:addFiles", { paths, ...target }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["resourcePacks"] });
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
      addLabel={t("resourcePacks.add")}
      dropHint={t("resourcePacks.drop")}
      actions={actions}
      status={
        <>
          {result && !nothing && (
            <p className="text-sm text-muted" aria-live="polite">
              {t("resourcePacks.added", {
                added: result.added,
                existing: result.existing,
              })}
              {result.failed.length > 0 &&
                ` ${t("resourcePacks.notAdded", {
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
