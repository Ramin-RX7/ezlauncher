import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { patchNotesNodes } from "./patchNotesHtml";

/** The Minecraft Wiki page of a version: for versions without Mojang patch notes. */
const wikiUrl = (versionId: string) =>
  `https://minecraft.wiki/w/Java_Edition_${encodeURIComponent(versionId)}`;

/** A Minecraft version's changelog (Mojang's patch notes). */
export function ChangelogDialog({
  versionId,
  onClose,
}: {
  versionId: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const notes = useQuery({
    queryKey: ["patchNotes", versionId],
    queryFn: () => invoke("versions:patchNotes", versionId),
    staleTime: Infinity,
  });
  const body = useMemo(
    () => (notes.data ? patchNotesNodes(notes.data.body) : null),
    [notes.data],
  );
  const date = notes.data
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(
        new Date(notes.data.date),
      )
    : undefined;
  const wiki = (
    <a
      href={wikiUrl(versionId)}
      target="_blank"
      rel="noreferrer"
      className="text-sm text-accent underline"
    >
      {t("versions.changelog.wiki")}
    </a>
  );

  return (
    <Dialog
      open
      wide
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={
        notes.data?.title ?? t("versions.changelog.title", { id: versionId })
      }
      {...(date && { description: date })}
      closeLabel={t("versions.changelog.close")}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t("versions.changelog.close")}
        </Button>
      }
    >
      {notes.isPending ? (
        <p className="text-sm text-muted">{t("versions.changelog.loading")}</p>
      ) : notes.isError ? (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-danger">
            {errorMessage(t, notes.error)}
          </p>
          {wiki}
        </div>
      ) : body ? (
        <div className="flex flex-col gap-3">
          <div className="max-h-[60vh] overflow-y-auto pe-2 text-sm leading-relaxed">
            {body}
          </div>
          {wiki}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">{t("versions.changelog.none")}</p>
          {wiki}
        </div>
      )}
    </Dialog>
  );
}
