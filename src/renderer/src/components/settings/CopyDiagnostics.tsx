import { useTranslation } from "react-i18next";
import { errorMessage } from "../../lib/errors";
import { useCopyDiagnostics } from "../../lib/useCopyDiagnostics";
import { Button } from "../ui/Button";

/** Settings → About: copy the details a bug report needs, and show them. */
export function CopyDiagnostics() {
  const { t } = useTranslation();
  const copy = useCopyDiagnostics();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => {
            copy.mutate(undefined);
          }}
          disabled={copy.isPending}
        >
          {copy.isPending ? t("diagnostics.copying") : t("diagnostics.copy")}
        </Button>
        {copy.isSuccess && (
          <span role="status" className="text-sm text-success">
            {t("diagnostics.copied")}
          </span>
        )}
        {copy.isError && (
          <span role="alert" className="text-sm text-danger">
            {t("diagnostics.failed", { error: errorMessage(t, copy.error) })}
          </span>
        )}
      </div>
      <p className="text-xs text-muted">{t("diagnostics.hint")}</p>
      {copy.data && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted hover:text-text">
            {t("diagnostics.show")}
          </summary>
          <pre
            dir="ltr"
            className="mt-2 max-h-72 overflow-auto rounded-ezl border border-border bg-bg p-3 font-mono text-xs whitespace-pre-wrap"
          >
            {copy.data}
          </pre>
        </details>
      )}
    </div>
  );
}
