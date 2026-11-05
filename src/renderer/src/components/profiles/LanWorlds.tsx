import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LogIn, Wifi } from "lucide-react";
import { invoke } from "../../lib/api";
import { Button } from "../ui/Button";

/**
 * Worlds opened to LAN on this network, found while this list is shown (the
 * launcher listens only then). Joining goes through the profile's Play bar.
 */
export function LanWorlds({
  onJoin,
}: {
  onJoin: (address: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const lan = useQuery({
    queryKey: ["lanWorlds"],
    queryFn: () => invoke("servers:lan"),
    refetchInterval: 2000,
  });
  const worlds = lan.data ?? [];

  return (
    <section className="flex flex-col gap-2" aria-labelledby="lan-heading">
      <h2 id="lan-heading" className="text-sm font-medium">
        {t("servers.lan.title")}
      </h2>
      {worlds.length === 0 ? (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Wifi size={14} aria-hidden />
          {t("servers.lan.looking")}
        </p>
      ) : (
        <ul className="overflow-hidden rounded-ezl border border-border bg-surface">
          {worlds.map((w) => {
            const name = w.name || t("servers.lan.unnamed");
            return (
              <li
                key={w.address}
                className="flex items-center gap-3 border-b border-border px-3 py-3 last:border-b-0"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-ezl bg-surface-2">
                  <Wifi size={16} className="text-muted" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{name}</span>
                  <span className="truncate text-xs text-muted">
                    {w.address}
                  </span>
                </span>
                <Button
                  variant="primary"
                  aria-label={t("servers.joinLabel", { name })}
                  onClick={() => {
                    onJoin(w.address, name);
                  }}
                >
                  <LogIn size={16} aria-hidden />
                  {t("servers.join")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
