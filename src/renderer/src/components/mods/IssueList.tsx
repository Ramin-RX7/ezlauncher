import { useTranslation } from "react-i18next";
import { CircleAlert, Download, RefreshCw, TriangleAlert } from "lucide-react";
import type { ValidationIssue } from "@shared/launcher";
import { Button } from "../ui/Button";
import { issueText } from "./issueText";

/** A mod's problems, errors first, with a fix button where there is one. */
export function IssueList({
  issues,
  busy = false,
  onDownload,
  onRedownload,
}: {
  issues: readonly ValidationIssue[];
  busy?: boolean;
  /** Search the mod sites for a missing mod. */
  onDownload?: (query: string) => void;
  onRedownload?: () => void;
}) {
  const { t } = useTranslation();
  if (issues.length === 0) return null;
  const sorted = [...issues].sort(
    (a, b) =>
      Number(a.severity === "warning") - Number(b.severity === "warning"),
  );
  return (
    <ul className="flex flex-col gap-1">
      {sorted.map((issue, i) => {
        const error = issue.severity === "error";
        const Icon = error ? CircleAlert : TriangleAlert;
        const fix = issue.fix;
        return (
          <li
            key={`${issue.code}-${String(i)}`}
            className={`flex flex-wrap items-center gap-2 text-xs ${error ? "text-danger" : "text-warning"}`}
          >
            <Icon size={14} className="shrink-0" aria-hidden />
            <span>{issueText(t, issue)}</span>
            {fix?.kind === "download" && onDownload && (
              <Button
                variant="secondary"
                className="h-7 px-2 text-xs"
                disabled={busy}
                onClick={() => {
                  onDownload(fix.query);
                }}
              >
                <Download size={14} aria-hidden />
                {t("validation.download")}
              </Button>
            )}
            {fix?.kind === "redownload" && onRedownload && (
              <Button
                variant="secondary"
                className="h-7 px-2 text-xs"
                disabled={busy}
                onClick={onRedownload}
              >
                <RefreshCw size={14} aria-hidden />
                {t("validation.redownload")}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
