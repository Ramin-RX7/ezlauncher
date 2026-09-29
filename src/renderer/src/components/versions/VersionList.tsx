import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ScrollText, Search } from "lucide-react";
import type { VersionSummary } from "@shared/launcher";
import { Input } from "../ui/Input";
import { TabBar } from "../ui/Tabs";
import { ChangelogDialog } from "./ChangelogDialog";

export type VersionTab = "release" | "snapshot" | "old_beta" | "old_alpha";
const TABS: readonly VersionTab[] = [
  "release",
  "snapshot",
  "old_beta",
  "old_alpha",
];

const ROW_HEIGHT = 44;
const OVERSCAN = 8;

export interface VersionListProps {
  versions: VersionSummary[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  /**
   * The version types to show (default: all). The selected version's type is always
   * shown, so a profile on a hidden type still shows its version.
   */
  types?: readonly VersionTab[];
  /** Shown in the same row as the tabs and the search (e.g. the list's refresh). */
  toolbar?: ReactNode;
}

function tabOf(type: string): VersionTab {
  return (TABS as readonly string[]).includes(type)
    ? (type as VersionTab)
    : "release";
}

/** Only the rows in view are rendered, so ~900 versions scroll smoothly. */
function useWindow(count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setHeight(el.clientHeight || 600);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(
    count,
    Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN,
  );
  return {
    ref,
    start,
    end,
    onScroll: (e: React.UIEvent<HTMLDivElement>) => {
      setScrollTop(e.currentTarget.scrollTop);
    },
    reset: () => {
      if (ref.current) ref.current.scrollTop = 0;
      setScrollTop(0);
    },
  };
}

export function VersionList({
  versions,
  selectedId,
  onSelect,
  types = TABS,
  toolbar,
}: VersionListProps) {
  const { t, i18n } = useTranslation();
  const selectedTab = tabOf(
    versions.find((v) => v.id === selectedId)?.type ?? "release",
  );
  const tabs = TABS.filter(
    (v) => v === "release" || v === selectedTab || types.includes(v),
  );
  const [picked, setTab] = useState<VersionTab>(selectedTab);
  const tab = tabs.includes(picked) ? picked : "release";
  const [query, setQuery] = useState("");
  const [notesFor, setNotesFor] = useState<string>();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Minecraft versions only: loader installs are picked through a profile's loader.
    return versions.filter(
      (v) =>
        !v.loader &&
        tabOf(v.type) === tab &&
        (!q || v.id.toLowerCase().includes(q)),
    );
  }, [versions, tab, query]);

  const {
    ref: listRef,
    start,
    end,
    onScroll,
    reset,
  } = useWindow(visible.length);
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }),
    [i18n.language],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {tabs.length > 1 ? (
          <TabBar
            label={t("versions.search")}
            items={tabs.map((value) => ({
              value,
              label: t(`versions.tabs.${value}`),
            }))}
            value={tab}
            onChange={(v) => {
              setTab(v);
              reset();
            }}
          />
        ) : (
          <span />
        )}
        {toolbar && (
          <div className="flex min-w-0 flex-1 justify-end">{toolbar}</div>
        )}
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute start-2.5 top-2.5 text-muted"
          />
          <Input
            type="search"
            aria-label={t("versions.search")}
            placeholder={t("versions.search")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              reset();
            }}
            className="w-52 ps-8"
          />
        </div>
      </div>

      <div
        ref={listRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto rounded-ezl border border-border bg-surface"
      >
        {visible.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">
            {t("versions.empty")}
          </p>
        ) : (
          <ul
            role="listbox"
            aria-label={t(`versions.tabs.${tab}`)}
            className="relative"
            style={{ height: visible.length * ROW_HEIGHT }}
          >
            {visible.slice(start, end).map((v, i) => {
              const selected = v.id === selectedId;
              return (
                <li
                  key={v.id}
                  role="option"
                  aria-selected={selected}
                  className={`absolute inset-x-0 flex items-center gap-3 border-b border-border px-3 ${selected ? "bg-surface-2" : "hover:bg-surface-2"}`}
                  style={{ top: (start + i) * ROW_HEIGHT, height: ROW_HEIGHT }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(v.id);
                    }}
                    className="flex h-full min-w-0 flex-1 items-center gap-3 text-start"
                  >
                    <span
                      className={`size-2 shrink-0 rounded-full ${selected ? "bg-accent" : "bg-transparent"}`}
                      aria-hidden
                    />
                    <span className="truncate font-medium">{v.id}</span>
                    <span className="text-xs text-muted">
                      {dateFormat.format(new Date(v.releaseTime))}
                    </span>
                    {v.installed && (
                      <span className="ms-auto rounded-ezl bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                        {t("versions.installed")}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={t("versions.changelog.open", { id: v.id })}
                    title={t("versions.changelog.open", { id: v.id })}
                    onClick={() => {
                      setNotesFor(v.id);
                    }}
                    className="rounded-ezl p-1.5 text-muted hover:bg-bg hover:text-text"
                  >
                    <ScrollText size={16} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {notesFor && (
        <ChangelogDialog
          versionId={notesFor}
          onClose={() => {
            setNotesFor(undefined);
          }}
        />
      )}
    </div>
  );
}
