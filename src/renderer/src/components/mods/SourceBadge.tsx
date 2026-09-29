import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { sourceName } from "./compatText";

/** "Modrinth ↗": where a mod came from, linking to its page (opens in the browser). */
export function SourceBadge({
  sourceId,
  pageUrl,
  modName,
}: {
  sourceId: string;
  pageUrl: string;
  modName: string;
}) {
  const { t } = useTranslation();
  const name = sourceName(t, sourceId);
  return (
    <a
      href={pageUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={t("mods.openPage", { name: modName, source: name })}
      className="inline-flex shrink-0 items-center gap-1 rounded-ezl bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent hover:underline"
    >
      {name}
      <ExternalLink size={12} aria-hidden />
    </a>
  );
}
