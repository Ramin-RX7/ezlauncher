import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LogIn, Server } from "lucide-react";
import type { ProfileInfo } from "@shared/launcher";
import { parseServerAddress } from "@shared/serverAddress";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

/**
 * Join a server straight from the launcher: the game's own server list (as edited
 * on its Multiplayer screen, only read here) or a typed address.
 */
export function ServersTab({
  profile,
  onJoin,
}: {
  profile: ProfileInfo;
  /** Start the profile onto this server (from the page's Play bar). */
  onJoin: (address: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const targets = useQuery({
    queryKey: ["profiles", "playTargets", profile.id],
    queryFn: () => invoke("profiles:playTargets", profile.id),
  });
  const [address, setAddress] = useState("");
  const typed = parseServerAddress(address);
  const servers = targets.data?.servers ?? [];

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed) onJoin(address.trim(), address.trim());
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">{t("servers.address")}</span>
          <Input
            value={address}
            placeholder="play.example.com:25565"
            aria-invalid={address.trim() !== "" && !typed}
            onChange={(e) => {
              setAddress(e.target.value);
            }}
            className="w-72"
          />
        </label>
        <Button type="submit" variant="primary" disabled={!typed}>
          <LogIn size={16} aria-hidden />
          {t("servers.join")}
        </Button>
        {address.trim() !== "" && !typed && (
          <span className="text-xs text-danger">{t("servers.badAddress")}</span>
        )}
      </form>

      {targets.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, targets.error)}
        </p>
      )}
      {targets.isSuccess &&
        (servers.length === 0 ? (
          <p className="rounded-ezl border border-border bg-surface p-6 text-center text-sm text-muted">
            {t("servers.empty")}
          </p>
        ) : (
          <ul className="overflow-hidden rounded-ezl border border-border bg-surface">
            {servers.map((s, i) => (
              <li
                key={`${s.address}-${String(i)}`}
                className="flex items-center gap-3 border-b border-border px-3 py-3 last:border-b-0"
              >
                <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-ezl bg-surface-2">
                  {s.icon ? (
                    <img
                      src={s.icon}
                      alt=""
                      className="size-full [image-rendering:pixelated]"
                    />
                  ) : (
                    <Server size={16} className="text-muted" aria-hidden />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{s.name}</span>
                  <span className="truncate text-xs text-muted">
                    {s.address}
                  </span>
                </span>
                <Button
                  variant="primary"
                  disabled={!parseServerAddress(s.address)}
                  aria-label={t("servers.joinLabel", { name: s.name })}
                  onClick={() => {
                    onJoin(s.address, s.name);
                  }}
                >
                  <LogIn size={16} aria-hidden />
                  {t("servers.join")}
                </Button>
              </li>
            ))}
          </ul>
        ))}
      <p className="text-xs text-muted">{t("servers.hint")}</p>
    </div>
  );
}
