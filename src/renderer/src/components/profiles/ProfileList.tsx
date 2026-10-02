import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Play } from "lucide-react";
import type { ProfileInfo } from "@shared/launcher";
import { ContextMenuArea, Menu, type MenuItem } from "../ui/Menu";
import { ProfileIcon } from "./ProfileIcon";

export interface ProfileListProps {
  profiles: ProfileInfo[];
  selectedId: string | null;
  /** Loader display names by id. */
  loaderNames: Record<string, string>;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  /** Play this profile with the selected account. */
  onPlay: (id: string) => void;
  /** Why this profile can't be played right now (no account, busy…), if it can't. */
  playBlocked?: (profile: ProfileInfo) => string | undefined;
  onOpenFolder: (id: string, folder: "game" | "mods") => void;
  onDelete: (id: string) => void;
}

/** Profiles, most recently played first. */
export function ProfileList({
  profiles,
  selectedId,
  loaderNames,
  onSelect,
  onEdit,
  onDuplicate,
  onPlay,
  playBlocked,
  onOpenFolder,
  onDelete,
}: ProfileListProps) {
  const { t, i18n } = useTranslation();
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }),
    [i18n.language],
  );
  const sorted = useMemo(
    () =>
      [...profiles].sort((a, b) =>
        (b.lastPlayedAt ?? b.createdAt).localeCompare(
          a.lastPlayedAt ?? a.createdAt,
        ),
      ),
    [profiles],
  );

  return (
    <ul
      role="listbox"
      aria-label={t("profiles.title")}
      className="overflow-hidden rounded-ezl border border-border bg-surface"
    >
      {sorted.map((p) => {
        const selected = p.id === selectedId;
        const blocked = playBlocked?.(p);
        const items: MenuItem[] = [
          {
            label: t("profiles.edit"),
            onSelect: () => {
              onEdit(p.id);
            },
          },
          {
            label: t("profiles.duplicate"),
            onSelect: () => {
              onDuplicate(p.id);
            },
          },
          {
            label: t("profiles.openFolder"),
            onSelect: () => {
              onOpenFolder(p.id, "game");
            },
          },
          ...(p.loader
            ? [
                {
                  label: t("mods.openFolder"),
                  onSelect: () => {
                    onOpenFolder(p.id, "mods");
                  },
                },
              ]
            : []),
          {
            label: t("profiles.delete"),
            danger: true,
            disabled: p.running > 0,
            onSelect: () => {
              onDelete(p.id);
            },
          },
        ];
        return (
          <ContextMenuArea key={p.id} items={items}>
            <li
              role="option"
              aria-selected={selected}
              className={`flex items-center gap-3 border-b border-border px-3 last:border-b-0 ${selected ? "bg-surface-2" : "hover:bg-surface-2"}`}
            >
              <button
                type="button"
                onClick={() => {
                  onSelect(p.id);
                }}
                onDoubleClick={() => {
                  onEdit(p.id);
                }}
                className="flex min-w-0 flex-1 items-center gap-3 py-3 text-start"
              >
                <ProfileIcon
                  profile={p}
                  className={selected ? "ring-2 ring-accent" : ""}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{p.name}</span>
                  <span className="truncate text-xs text-muted">
                    {[
                      p.modpack &&
                        t("modpacks.badge", {
                          name: p.modpack.name,
                          version: p.modpack.versionNumber,
                        }),
                      p.lastPlayedAt
                        ? t("profiles.lastPlayed", {
                            date: dateFormat.format(new Date(p.lastPlayedAt)),
                          })
                        : t("profiles.neverPlayed"),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="ms-auto flex shrink-0 items-center gap-2">
                  {p.running > 0 && (
                    <span className="rounded-ezl bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                      {t("profiles.running", { count: p.running })}
                    </span>
                  )}
                  <span className="text-sm">{p.gameVersion}</span>
                  {p.loader && (
                    <span className="rounded-ezl border border-border px-2 py-0.5 text-xs text-muted">
                      {loaderNames[p.loader.id] ?? p.loader.id}
                    </span>
                  )}
                </span>
              </button>
              <button
                type="button"
                aria-label={t("profiles.playProfile", { name: p.name })}
                title={blocked ?? t("profiles.playProfile", { name: p.name })}
                disabled={blocked !== undefined}
                onClick={() => {
                  onPlay(p.id);
                }}
                className="flex size-9 shrink-0 items-center justify-center rounded-ezl bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-40"
              >
                <Play size={16} aria-hidden />
              </button>
              <Menu
                trigger={
                  <button
                    type="button"
                    aria-label={t("profiles.menu", { name: p.name })}
                    className="rounded-ezl p-1.5 text-muted hover:bg-bg hover:text-text"
                  >
                    <MoreHorizontal size={16} />
                  </button>
                }
                items={items}
              />
            </li>
          </ContextMenuArea>
        );
      })}
    </ul>
  );
}
