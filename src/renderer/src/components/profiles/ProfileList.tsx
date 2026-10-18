import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Pin, Play } from "lucide-react";
import type { ProfileInfo } from "@shared/launcher";
import { ContextMenuArea, Menu, type MenuItem } from "../ui/Menu";
import { formatDuration } from "../../lib/formatDuration";
import { ProfileIcon } from "./ProfileIcon";

export interface ProfileListProps {
  /** In display order. */
  profiles: ProfileInfo[];
  /** The list's accessible name (default: Profiles). */
  label?: string;
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
  /** Keep at the top of the list, or not. */
  onPin: (id: string, pinned: boolean) => void;
  /** Open the folder every profile's screenshots go to. */
  onOpenScreenshots: () => void;
  /** Copy a bug report's details about this profile. */
  onCopyDiagnostics: (id: string) => void;
  /** Make a desktop shortcut to the profile (missing = not offered here). */
  onShortcut?: (id: string) => void;
  onDelete: (id: string) => void;
}

/** Profiles, in the order given. */
export function ProfileList({
  profiles,
  label,
  selectedId,
  loaderNames,
  onSelect,
  onEdit,
  onDuplicate,
  onPlay,
  playBlocked,
  onOpenFolder,
  onPin,
  onOpenScreenshots,
  onCopyDiagnostics,
  onShortcut,
  onDelete,
}: ProfileListProps) {
  const { t, i18n } = useTranslation();
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }),
    [i18n.language],
  );

  return (
    <ul
      role="listbox"
      aria-label={label ?? t("profiles.title")}
      className="overflow-hidden rounded-ezl border border-border bg-surface"
    >
      {profiles.map((p) => {
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
            label: p.pinned ? t("profiles.unpin") : t("profiles.pin"),
            onSelect: () => {
              onPin(p.id, !p.pinned);
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
          {
            label: t("profiles.openScreenshots"),
            onSelect: onOpenScreenshots,
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
          ...(onShortcut
            ? [
                {
                  label: t("shortcut.create"),
                  onSelect: () => {
                    onShortcut(p.id);
                  },
                },
              ]
            : []),
          {
            label: t("diagnostics.copy"),
            onSelect: () => {
              onCopyDiagnostics(p.id);
            },
          },
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
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium">{p.name}</span>
                    {p.pinned && (
                      <Pin
                        size={12}
                        aria-label={t("profiles.pinned")}
                        className="shrink-0 text-muted"
                      />
                    )}
                  </span>
                  <span className="truncate text-xs text-muted">
                    {[
                      p.modpack &&
                        t("modpacks.badge", {
                          name: p.modpack.name,
                          version: p.modpack.versionNumber,
                        }),
                      (p.playTimeMs ?? 0) >= 60_000 &&
                        t("playTime.played", {
                          time: formatDuration(t, p.playTimeMs ?? 0),
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
