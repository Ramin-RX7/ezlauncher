import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FolderOpen } from "lucide-react";
import { Button } from "../components/ui/Button";
import { invoke } from "../lib/api";
import { errorMessage } from "../lib/errors";

/** First start: choose where the launcher keeps its data. */
export function SetupPage({
  suggestedDir,
  onDone,
}: {
  suggestedDir: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [dir, setDir] = useState(suggestedDir);
  const save = useMutation({
    mutationFn: () => invoke("setup:setDataDir", dir),
    onSuccess: onDone,
  });

  return (
    <main className="flex h-full items-center justify-center p-8">
      <div className="flex w-full max-w-lg flex-col gap-6 rounded-ezl border border-border bg-surface p-8">
        <div>
          <h1 className="text-2xl font-semibold">
            {t("setup.title", { name: t("app.name") })}
          </h1>
          <p className="mt-2 text-sm text-muted">{t("setup.subtitle")}</p>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t("setup.folderLabel")}</span>
          <div className="flex items-center gap-2">
            <code
              dir="ltr"
              className="min-w-0 flex-1 truncate rounded-ezl border border-border bg-bg px-3 py-2 text-sm"
            >
              {dir}
            </code>
            <Button
              onClick={() => {
                void invoke("setup:chooseFolder").then((chosen) => {
                  if (chosen) setDir(chosen);
                });
              }}
            >
              <FolderOpen size={16} aria-hidden />
              {t("setup.choose")}
            </Button>
          </div>
          <p className="text-xs text-muted">{t("setup.hint")}</p>
        </div>
        {save.isError && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(t, save.error)}
          </p>
        )}
        <Button
          variant="primary"
          className="self-end"
          disabled={save.isPending}
          onClick={() => {
            save.mutate();
          }}
        >
          {t("setup.continue")}
        </Button>
      </div>
    </main>
  );
}
