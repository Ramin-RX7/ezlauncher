import { useState, type DragEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import type { AddModsResult } from "@shared/launcher";
import { invoke, pathForFile } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { Button } from "../ui/Button";

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");

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
  const [over, setOver] = useState(false);
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
    <div
      className={`flex min-h-0 flex-1 flex-col gap-3 rounded-ezl ${over ? "outline-2 outline-accent outline-dashed" : ""}`}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOver(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setOver(false);
        const paths = [...e.dataTransfer.files]
          .filter((f) => /\.jar$/i.test(f.name))
          .map(pathForFile)
          .filter(Boolean);
        if (paths.length > 0) add.mutate(paths);
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        {actions}
        <Button
          variant="secondary"
          disabled={add.isPending}
          onClick={() => {
            add.mutate("picker");
          }}
        >
          <Plus size={16} aria-hidden />
          {t("mods.add")}
        </Button>
        <span className="text-xs text-muted">{t("mods.drop")}</span>
      </div>
      {result && !nothing && (
        <p className="text-sm text-muted" aria-live="polite">
          {t("mods.added", { added: result.added, existing: result.existing })}
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
      {children}
    </div>
  );
}
