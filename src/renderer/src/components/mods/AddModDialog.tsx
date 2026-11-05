import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import type { ProfileInfo } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Input } from "../ui/Input";
import { reasonText } from "./compatText";
import { ModIcon } from "./ModIcon";
import { groupMods } from "./modGroups";
import { ModSearchResults } from "./ModSearchResults";
import { VersionPicker } from "./VersionPicker";

/**
 * Add a mod to a profile: from the library (typing filters it, one row per mod
 * with its versions), or from Modrinth's mods for the profile's version and
 * loader, each opened to see what Download would fetch.
 */
export function AddModDialog({
  profile,
  onClose,
  initialQuery = "",
}: {
  profile: ProfileInfo;
  onClose: () => void;
  /** Start with this text in the search box (e.g. a missing mod's id); a mod named exactly so opens by itself. */
  initialQuery?: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState(initialQuery);
  /** Picked version per mod, by group key. */
  const [picked, setPicked] = useState<Record<string, string>>({});
  const library = useQuery({
    queryKey: ["mods", "library", profile.id],
    queryFn: () => invoke("mods:library", { profileId: profile.id }),
  });
  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      q
        ? groupMods(library.data ?? [])
            .filter((g) =>
              g.versions.some(
                (m) =>
                  m.name.toLowerCase().includes(q) ||
                  (m.modId?.toLowerCase().includes(q) ?? false),
              ),
            )
            .map((g) => {
              const choice = g.versions.find((v) => v.sha1 === picked[g.key]);
              return choice ? { ...g, current: choice } : g;
            })
        : [],
    [library.data, q, picked],
  );

  const enable = useMutation({
    mutationFn: (sha1: string) =>
      invoke("mods:setEnabled", { profileId: profile.id, sha1, enabled: true }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["mods"] });
    },
  });
  return (
    <Dialog
      open
      wide
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("remote.title", { profile: profile.name })}
      closeLabel={t("remote.close")}
    >
      <div className="flex max-h-[70vh] flex-col gap-3">
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <Search
            size={16}
            className="pointer-events-none absolute start-2.5 top-2.5 text-muted"
          />
          <Input
            type="search"
            autoFocus
            aria-label={t("remote.search")}
            placeholder={t("remote.searchPlaceholder")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            className="w-full ps-8"
          />
        </form>

        <div className="flex min-h-0 flex-col gap-3 overflow-auto">
          {q && (
            <section className="flex flex-col gap-1">
              <h3 className="text-xs font-medium text-muted">
                {t("remote.libraryHeading")}
              </h3>
              {matches.length === 0 ? (
                <p className="text-sm text-muted">
                  {t("remote.noLibraryMatch")}
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {matches.map((g) => {
                    const m = g.current;
                    const status = m.compat?.status ?? "unknown";
                    return (
                      <li key={g.key} className="flex items-center gap-3">
                        <ModIcon mod={m} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-medium">
                            {m.name}
                          </span>
                          {status !== "compatible" && (
                            <span
                              className={`text-xs ${status === "incompatible" ? "text-danger" : "text-warning"}`}
                            >
                              {m.compat?.reason
                                ? reasonText(t, m.compat.reason)
                                : t(`mods.compat.${status}`)}
                            </span>
                          )}
                        </span>
                        {g.versions.length > 1 && (
                          <VersionPicker
                            versions={g.versions}
                            value={m.sha1}
                            name={m.name}
                            disabled={enable.isPending}
                            onChange={(sha1) => {
                              setPicked((p) => ({ ...p, [g.key]: sha1 }));
                            }}
                          />
                        )}
                        <Button
                          variant="secondary"
                          disabled={
                            m.enabled === true ||
                            status === "incompatible" ||
                            profile.running > 0 ||
                            enable.isPending
                          }
                          onClick={() => {
                            enable.mutate(m.sha1);
                          }}
                        >
                          {m.enabled ? t("remote.picked") : t("remote.pick")}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
          {enable.isError && (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(t, enable.error)}
            </p>
          )}

          <ModSearchResults profile={profile} query={query} />
        </div>
      </div>
    </Dialog>
  );
}
