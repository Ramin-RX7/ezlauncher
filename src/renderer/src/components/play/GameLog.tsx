import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { launcherStore, useLauncherState } from "../../state/launcherStore";
import { useAccounts, useProfiles } from "../../state/queries";

/**
 * Collapsible live view of the games' output, one tab per game (running, or one of
 * the last closed ones). Keeps following the end unless scrolled up.
 */
export function GameLog({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const games = useLauncherState((s) => s.games);
  const profiles = useProfiles();
  const accounts = useAccounts();
  const [picked, setPicked] = useState<string>();
  const ref = useRef<HTMLPreElement>(null);
  const stick = useRef(true);

  // The picked tab, or the newest game when it's gone (or none was picked).
  const shown =
    games.find((g) => g.launchId === picked) ?? games[games.length - 1];
  const lines = useMemo(() => shown?.lines ?? [], [shown]);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines, open]);

  const label = (profileId: string, accountId: string) =>
    t("log.tab", {
      profile:
        profiles.data?.find((p) => p.id === profileId)?.name ?? profileId,
      account: accounts.data?.find((a) => a.id === accountId)?.username ?? "…",
    });

  return (
    <section className="rounded-ezl border border-border bg-surface">
      <div className="flex items-center justify-between px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex items-center gap-1 text-sm font-medium"
        >
          {open ? (
            <ChevronDown size={16} />
          ) : (
            <ChevronRight size={16} className="rtl:rotate-180" />
          )}
          {t("log.title")}
        </button>
        {open && games.some((g) => g.exit) && (
          <button
            type="button"
            onClick={() => {
              launcherStore.clearClosed();
            }}
            className="text-xs text-muted hover:text-text"
          >
            {t("log.clear")}
          </button>
        )}
      </div>
      {open && games.length > 1 && (
        <div
          role="tablist"
          aria-label={t("log.games")}
          className="flex flex-wrap gap-1 border-t border-border px-2 pt-2"
        >
          {games.map((g) => {
            const selected = g.launchId === shown?.launchId;
            return (
              <button
                key={g.launchId}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  setPicked(g.launchId);
                  stick.current = true;
                }}
                className={`rounded-ezl px-2 py-1 text-xs ${selected ? "bg-surface-2 text-text" : "text-muted hover:text-text"}`}
              >
                {label(g.profileId, g.accountId)}
                {g.exit && " "}
                {g.exit && (
                  <span
                    className={g.exit.crashed ? "text-danger" : "text-muted"}
                  >
                    {t("log.exited", { code: String(g.exit.code) })}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {open && (
        <pre
          ref={ref}
          dir="ltr"
          role={games.length > 1 ? "tabpanel" : undefined}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
          className="h-56 overflow-auto border-t border-border bg-bg p-3 font-mono text-xs leading-relaxed text-muted"
        >
          {lines.length === 0 ? t("log.empty") : lines.join("\n")}
        </pre>
      )}
    </section>
  );
}
