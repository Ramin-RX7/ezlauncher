import type { ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AddModsResult } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { FileDropZone } from "../ui/FileDropZone";

/**
 * An area that takes dropped `.jar` files, with an Add mods button (file picker).
 * With a profile, added mods are also enabled there when they fit it.
 */
export function AddMods({
  profileId,
  actions,
  children,
}: {
  profileId?: string;
  /** More buttons, shown before Add jar files. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const target = profileId ? { profileId } : {};

  const add = useMutation({
    mutationFn: (paths: string[] | "picker"): Promise<AddModsResult> =>
      paths === "picker"
        ? invoke("mods:addFromPicker", target)
        : invoke("mods:addFiles", { paths, ...target }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mods"] });
    },
  });
  const result = add.data;
  const nothing =
    result && result.added + result.existing + result.failed.length === 0;

  return (
    <FileDropZone
      accept={/\.jar$/i}
      onAdd={(paths) => {
        add.mutate(paths);
      }}
      pending={add.isPending}
      addLabel={t("mods.add")}
      dropHint={t("mods.drop")}
      actions={actions}
      status={
        <>
          {result && !nothing && (
            <p className="text-sm text-muted" aria-live="polite">
              {t("mods.added", {
                added: result.added,
                existing: result.existing,
              })}
              {result.failed.length > 0 &&
                ` ${t("mods.notAdded", {
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
