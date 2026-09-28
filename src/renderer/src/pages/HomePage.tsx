import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import { invoke } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Tooltip } from "../components/ui/Tooltip";

export function HomePage() {
  const { t } = useTranslation();
  const info = useQuery({
    queryKey: ["app", "info"],
    queryFn: () => invoke("app:getInfo"),
  });
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <section className="max-w-2xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("home.title")}</h1>
          <p className="mt-1 text-muted">{t("home.subtitle")}</p>
        </div>
        <Tooltip content={t("home.about")}>
          <Button
            variant="ghost"
            aria-label={t("home.about")}
            onClick={() => {
              setAboutOpen(true);
            }}
          >
            <Info size={18} />
          </Button>
        </Tooltip>
        <Dialog
          open={aboutOpen}
          onOpenChange={setAboutOpen}
          title={t("about.title")}
          closeLabel={t("about.close")}
        >
          {info.data && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted">{t("about.version")}</dt>
              <dd>{info.data.version}</dd>
              <dt className="text-muted">{t("about.platform")}</dt>
              <dd>
                {info.data.platform}-{info.data.arch}
              </dd>
              <dt className="text-muted">{t("about.electron")}</dt>
              <dd>{info.data.electron}</dd>
              <dt className="text-muted">{t("about.node")}</dt>
              <dd>{info.data.node}</dd>
            </dl>
          )}
        </Dialog>
      </div>

      <div className="mt-8 rounded-ezl border border-border bg-surface p-4 text-sm">
        {info.isPending && <p className="text-muted">{t("home.loading")}</p>}
        {info.isError && <p className="text-danger">{t("home.error")}</p>}
        {info.data && (
          <p data-testid="app-version">
            {t("app.name")} {info.data.version} · {info.data.platform}-
            {info.data.arch}
          </p>
        )}
      </div>
    </section>
  );
}
