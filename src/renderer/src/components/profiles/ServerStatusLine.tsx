import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { invoke } from "../../lib/api";
import { keys } from "../../state/queries";

/** Online or offline, players, latency and version, then the server's message. */
export function ServerStatusLine({ address }: { address: string }) {
  const { t } = useTranslation();
  const status = useQuery({
    queryKey: [...keys.serverStatus, address],
    queryFn: () => invoke("servers:status", address),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });

  if (status.isPending)
    return (
      <span className="text-xs text-muted">{t("servers.status.checking")}</span>
    );
  const data = status.data;
  if (!data?.online)
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted">
        <span className="size-2 rounded-full bg-muted" aria-hidden />
        {t("servers.status.offline")}
      </span>
    );
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex items-center gap-1.5 text-xs text-muted">
        <span className="size-2 shrink-0 rounded-full bg-success" aria-hidden />
        {[
          t("servers.status.players", {
            online: data.players.online,
            max: data.players.max,
          }),
          t("servers.status.latency", { ms: data.latencyMs }),
          data.version,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
      {data.motd && (
        <span className="truncate text-xs text-muted" title={data.motd}>
          {data.motd}
        </span>
      )}
    </span>
  );
}
