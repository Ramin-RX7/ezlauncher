import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  CircleCheck,
  CornerDownRight,
  FolderOpen,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type {
  LibraryMod,
  ProfileInfo,
  ValidationIssue,
  ValidationReport,
} from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { AddModDialog } from "./AddModDialog";
import { AddMods } from "./AddMods";
import { reasonText } from "./compatText";
import { IssueList } from "./IssueList";
import { ModIcon } from "./ModIcon";
import { ModUpdatesDialog } from "./ModUpdatesDialog";
import { groupMods, type ModGroup } from "./modGroups";
import { SourceBadge } from "./SourceBadge";
import { VersionPicker } from "./VersionPicker";

const ORDER = { compatible: 0, unknown: 1, incompatible: 2 } as const;

/** One enabled mod in the tree, with the enabled mods it needs under it. */
interface TreeNode {
  mod: LibraryMod;
  group?: ModGroup;
  /** Names of the enabled mods that need it. */
  users: string[];
  children: TreeNode[];
}

/**
 * Enabled mods as a tree: a mod that other enabled mods need is shown under each of
 * them, never at the top. Mods caught in a cycle come to the top, so none is lost.
 */
function buildTree(
  enabled: readonly LibraryMod[],
  requiredBy: Record<string, string[]>,
  groups: readonly ModGroup[],
): TreeNode[] {
  const bySha1 = new Map(enabled.map((m) => [m.sha1, m]));
  const users = (sha1: string) =>
    (requiredBy[sha1] ?? []).filter((u) => u !== sha1 && bySha1.has(u));
  const needs = (sha1: string) =>
    enabled.filter((m) => users(m.sha1).includes(sha1));
  const groupOf = (m: LibraryMod) => groups.find((g) => g.current === m);

  const reached = new Set<string>();
  const node = (m: LibraryMod, path: ReadonlySet<string>): TreeNode => {
    reached.add(m.sha1);
    const here = new Set(path).add(m.sha1);
    const group = groupOf(m);
    return {
      mod: m,
      ...(group && { group }),
      users: users(m.sha1)
        .map((u) => bySha1.get(u)?.name ?? u)
        .sort((a, b) => a.localeCompare(b)),
      children: needs(m.sha1)
        .filter((d) => !here.has(d.sha1))
        .map((d) => node(d, here)),
    };
  };
  const roots = enabled
    .filter((m) => users(m.sha1).length === 0)
    .map((m) => node(m, new Set()));
  for (const m of enabled)
    if (!reached.has(m.sha1)) roots.push(node(m, new Set()));
  return roots.sort((a, b) => a.mod.name.localeCompare(b.mod.name));
}

const matches = (m: LibraryMod, q: string) =>
  m.name.toLowerCase().includes(q) ||
  (m.modId?.toLowerCase().includes(q) ?? false);
const treeMatches = (n: TreeNode, q: string): boolean =>
  matches(n.mod, q) || n.children.some((c) => treeMatches(c, q));

/**
 * Tick library mods for a profile, one row per mod (with a version picker).
 * Enabled mods show the ones they need under them, locked; problems from the
 * mod check are shown on each row, with a summary at the top.
 */
export function ModsTab({ profile }: { profile: ProfileInfo }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<{ query?: string } | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [alsoDisabled, setAlsoDisabled] = useState<string[]>([]);
  /** Picked versions of mods that aren't enabled, by group. */
  const [picked, setPicked] = useState<Record<string, string>>({});
  const library = useQuery({
    queryKey: ["mods", "library", profile.id],
    queryFn: () => invoke("mods:library", { profileId: profile.id }),
  });
  const report = useQuery({
    queryKey: ["mods", "validate", profile.id],
    queryFn: () => invoke("mods:validate", { profileId: profile.id }),
    enabled: profile.loader !== null,
  });
  // The last update check (made by ModUpdatesDialog), only read here: no network.
  const updateCheck = useQuery({
    queryKey: ["mods", "updates", profile.id],
    queryFn: () => invoke("mods:checkUpdates", profile.id),
    enabled: false,
  });
  const updates = useMemo(
    () =>
      new Map(
        (updateCheck.data?.updates ?? []).map((u) => [u.sha1, u.toVersion]),
      ),
    [updateCheck.data],
  );
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["mods"] });
  };

  const toggle = useMutation({
    mutationFn: (args: { sha1: string; enabled: boolean }) =>
      invoke("mods:setEnabled", { profileId: profile.id, ...args }),
    onMutate: () => {
      setAlsoDisabled([]);
    },
    onSuccess: ({ disabled }) => {
      setAlsoDisabled(disabled);
    },
    onSettled: invalidate,
  });
  const checkAll = useMutation({
    mutationFn: () =>
      invoke("mods:validate", { profileId: profile.id, full: true }),
    onSuccess: (full: ValidationReport) => {
      queryClient.setQueryData(["mods", "validate", profile.id], full);
    },
  });
  const openFolder = useMutation({
    mutationFn: () => invoke("profiles:openFolder", profile.id, "mods"),
  });
  const redownload = useMutation({
    mutationFn: (sha1: string) => invoke("mods:redownload", sha1),
    onSettled: invalidate,
  });

  const mods = useMemo(() => library.data ?? [], [library.data]);
  const current = checkAll.data ?? report.data;
  const issuesOf = useMemo(() => {
    const map = new Map<string, ValidationIssue[]>();
    for (const i of current?.issues ?? [])
      map.set(i.modSha1, [...(map.get(i.modSha1) ?? []), i]);
    return map;
  }, [current]);

  const { tree, disabledGroups } = useMemo(() => {
    const groups = groupMods(mods);
    const enabled = mods.filter((m) => m.enabled);
    const q = query.trim().toLowerCase();
    return {
      tree: buildTree(enabled, current?.requiredBy ?? {}, groups).filter(
        (n) => !q || treeMatches(n, q),
      ),
      disabledGroups: groups
        .filter((g) => !g.current.enabled)
        .map((g) => {
          const choice = g.versions.find((v) => v.sha1 === picked[g.key]);
          return choice ? { ...g, current: choice } : g;
        })
        .filter((g) => !q || g.versions.some((v) => matches(v, q)))
        .sort(
          (a, b) =>
            ORDER[a.current.compat?.status ?? "unknown"] -
              ORDER[b.current.compat?.status ?? "unknown"] ||
            a.current.name.localeCompare(b.current.name),
        ),
    };
  }, [mods, current, query, picked]);

  if (!profile.loader) {
    return (
      <p className="rounded-ezl border border-border bg-surface p-6 text-sm text-muted">
        {t("mods.vanilla")}
      </p>
    );
  }
  const anyCopied = mods.some((m) => m.enabled && m.copied);
  const running = profile.running > 0;
  const busy = running || toggle.isPending;
  const nameOf = (sha1: string) =>
    mods.find((m) => m.sha1 === sha1)?.name ?? sha1;

  const rowProps = {
    issuesOf,
    updates,
    busy,
    fixBusy: running || redownload.isPending,
    onDownload: (q: string) => {
      setAdding({ query: q });
    },
    onRedownload: (sha1: string) => {
      redownload.mutate(sha1);
    },
  };

  return (
    <AddMods
      profileId={profile.id}
      actions={
        <>
          <Button
            variant="primary"
            onClick={() => {
              setAdding({});
            }}
          >
            <Plus size={16} aria-hidden />
            {t("mods.addMod")}
          </Button>
          <Button
            onClick={() => {
              setCheckingUpdates(true);
            }}
          >
            <RefreshCw size={16} aria-hidden />
            {t("mods.updates.check")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              openFolder.mutate();
            }}
          >
            <FolderOpen size={16} aria-hidden />
            {t("mods.openFolder")}
          </Button>
        </>
      }
    >
      {checkingUpdates && (
        <ModUpdatesDialog
          profile={profile}
          onClose={() => {
            setCheckingUpdates(false);
          }}
        />
      )}
      {adding && (
        <AddModDialog
          profile={profile}
          {...(adding.query && {
            initialQuery: adding.query,
            autoSearch: true,
          })}
          onClose={() => {
            setAdding(null);
          }}
        />
      )}
      <Summary
        report={current}
        checking={report.isFetching || checkAll.isPending}
        onCheck={() => {
          checkAll.mutate();
        }}
      />
      {anyCopied && (
        <p className="flex items-center gap-2 text-sm text-warning">
          <TriangleAlert size={16} aria-hidden />
          {t("mods.copied")}
        </p>
      )}
      {running && (
        <p className="text-sm text-muted">{t("worlds.runningBlocked")}</p>
      )}
      {[toggle, redownload, checkAll, openFolder].map(
        (m, i) =>
          m.isError && (
            <p key={i} role="alert" className="text-sm text-danger">
              {errorMessage(t, m.error)}
            </p>
          ),
      )}
      {alsoDisabled.length > 0 && (
        <p className="text-sm text-muted" aria-live="polite">
          {t("mods.alsoDisabled", {
            names: alsoDisabled.map(nameOf).join(", "),
          })}
        </p>
      )}
      <div className="relative w-fit">
        <Search
          size={16}
          className="pointer-events-none absolute start-2.5 top-2.5 text-muted"
        />
        <Input
          type="search"
          aria-label={t("mods.search")}
          placeholder={t("mods.search")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          className="w-64 ps-8"
        />
      </div>
      {library.isSuccess && mods.length === 0 ? (
        <p className="rounded-ezl border border-dashed border-border p-6 text-center text-sm text-muted">
          {t("mods.empty")}
        </p>
      ) : (
        <ul className="min-h-0 overflow-auto rounded-ezl border border-border bg-surface">
          {tree.length === 0 &&
            disabledGroups.length === 0 &&
            library.isSuccess && (
              <li className="p-6 text-center text-sm text-muted">
                {t("mods.noMatch")}
              </li>
            )}
          {tree.map((n) => (
            <EnabledRow
              key={n.mod.sha1}
              node={n}
              {...rowProps}
              onToggle={(sha1, enabled) => {
                toggle.mutate({ sha1, enabled });
              }}
            />
          ))}
          {disabledGroups.map((g) => (
            <li
              key={g.key}
              className="border-b border-border px-3 py-2 last:border-b-0"
            >
              <ModLine
                mod={g.current}
                group={g}
                disabled={busy}
                onToggle={(enabled) => {
                  toggle.mutate({ sha1: g.current.sha1, enabled });
                }}
                onPick={(sha1) => {
                  setPicked((p) => ({ ...p, [g.key]: sha1 }));
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </AddMods>
  );
}

function Summary({
  report,
  checking,
  onCheck,
}: {
  report: ValidationReport | undefined;
  checking: boolean;
  onCheck: () => void;
}) {
  const { t } = useTranslation();
  let text: string;
  let tone = "text-muted";
  if (!report) text = t("validation.checking");
  else if (report.errorCount + report.warningCount === 0) {
    text = t("validation.allGood");
    tone = "text-success";
  } else {
    text = [
      report.errorCount > 0 &&
        t("validation.errors", { count: report.errorCount }),
      report.warningCount > 0 &&
        t("validation.warnings", { count: report.warningCount }),
    ]
      .filter(Boolean)
      .join(" · ");
    tone = report.errorCount > 0 ? "text-danger" : "text-warning";
  }
  const Icon =
    report && report.errorCount + report.warningCount === 0
      ? CircleCheck
      : TriangleAlert;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p
        className={`flex items-center gap-2 text-sm font-medium ${tone}`}
        aria-live="polite"
      >
        <Icon size={16} aria-hidden />
        {text}
      </p>
      <Button
        variant="ghost"
        className="h-8 px-2"
        title={t("validation.checkHint")}
        disabled={checking}
        onClick={onCheck}
      >
        <ShieldCheck size={16} aria-hidden />
        {t("validation.check")}
      </Button>
    </div>
  );
}

interface RowProps {
  issuesOf: Map<string, ValidationIssue[]>;
  /** Enabled mod → the newer version the last update check found. */
  updates: ReadonlyMap<string, string>;
  busy: boolean;
  fixBusy: boolean;
  onDownload: (query: string) => void;
  onRedownload: (sha1: string) => void;
}

/** An enabled top-level mod, and under it the mods it needs (locked). */
function EnabledRow({
  node,
  onToggle,
  ...props
}: RowProps & {
  node: TreeNode;
  onToggle: (sha1: string, enabled: boolean) => void;
}) {
  const { mod, group } = node;
  return (
    <li className="border-b border-border px-3 py-2 last:border-b-0">
      <ModLine
        mod={mod}
        {...(group && { group })}
        updateTo={props.updates.get(mod.sha1)}
        disabled={props.busy}
        onToggle={(enabled) => {
          onToggle(mod.sha1, enabled);
        }}
        onPick={(sha1) => {
          onToggle(sha1, true); // enabling another version replaces this one
        }}
      />
      <Issues mod={mod} {...props} />
      {node.children.length > 0 && (
        <ul className="ms-2 mt-1 flex flex-col gap-1 border-s border-border ps-3">
          {node.children.map((c) => (
            <DependencyRow key={c.mod.sha1} node={c} {...props} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** A mod another enabled mod needs: shown under it, and it can't be unticked here. */
function DependencyRow({ node, ...props }: RowProps & { node: TreeNode }) {
  const { t } = useTranslation();
  const { mod } = node;
  const names = node.users.join(", ");
  return (
    <li className="flex flex-col gap-1 py-1">
      <div className="flex items-center gap-3">
        <CornerDownRight
          size={14}
          className="shrink-0 text-muted"
          aria-hidden
        />
        <Lock
          size={14}
          className="shrink-0 text-muted"
          aria-label={t("mods.locked", { name: mod.name, names })}
          role="img"
        />
        <ModIcon mod={mod} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{mod.name}</span>
            {mod.source && (
              <SourceBadge
                sourceId={mod.source.sourceId}
                pageUrl={mod.source.pageUrl}
                modName={mod.name}
              />
            )}
          </span>
          <span className="truncate text-xs text-muted">
            {[
              mod.version
                ? t("mods.version", { version: mod.version })
                : t("mods.unknownVersion"),
              t("mods.requiredBy", { names }),
            ].join(" · ")}
          </span>
        </span>
      </div>
      <div className="ps-12">
        <Issues mod={mod} {...props} />
      </div>
      {node.children.length > 0 && (
        <ul className="ms-8 flex flex-col gap-1 border-s border-border ps-3">
          {node.children.map((c) => (
            <DependencyRow key={c.mod.sha1} node={c} {...props} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Issues({
  mod,
  issuesOf,
  fixBusy,
  onDownload,
  onRedownload,
}: RowProps & { mod: LibraryMod }) {
  return (
    <IssueList
      issues={issuesOf.get(mod.sha1) ?? []}
      busy={fixBusy}
      onDownload={onDownload}
      onRedownload={() => {
        onRedownload(mod.sha1);
      }}
    />
  );
}

/** Checkbox, icon, name, version picker and compatibility of one mod. */
function ModLine({
  mod,
  group,
  updateTo,
  disabled,
  onToggle,
  onPick,
}: {
  mod: LibraryMod;
  group?: ModGroup;
  /** A newer version found by the last update check. */
  updateTo?: string | undefined;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
  onPick: (sha1: string) => void;
}) {
  const { t } = useTranslation();
  const status = mod.compat?.status ?? "unknown";
  const incompatible = status === "incompatible" && !mod.enabled;
  const id = `mod-${mod.sha1}`;
  const versions = group?.versions ?? [];
  return (
    <div
      className={`flex items-center gap-3 ${incompatible ? "opacity-60" : ""}`}
    >
      <input
        id={id}
        type="checkbox"
        className="size-4 accent-accent"
        checked={mod.enabled === true}
        disabled={disabled || incompatible}
        aria-label={t("mods.enable", { name: mod.name })}
        onChange={(e) => {
          onToggle(e.target.checked);
        }}
      />
      <ModIcon mod={mod} />
      <label htmlFor={id} className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{mod.name}</span>
          {mod.source && (
            <SourceBadge
              sourceId={mod.source.sourceId}
              pageUrl={mod.source.pageUrl}
              modName={mod.name}
            />
          )}
          {updateTo && (
            <span className="shrink-0 rounded-ezl border border-accent px-1.5 text-xs text-accent">
              {t("mods.updates.availableVersion", { version: updateTo })}
            </span>
          )}
        </span>
        {versions.length < 2 && (
          <span className="truncate text-xs text-muted">
            {mod.version
              ? t("mods.version", { version: mod.version })
              : t("mods.unknownVersion")}
          </span>
        )}
      </label>
      {versions.length >= 2 && (
        <VersionPicker
          versions={versions}
          value={mod.sha1}
          name={mod.name}
          disabled={disabled}
          onChange={onPick}
        />
      )}
      {!mod.enabled && (
        <span
          className={`shrink-0 text-xs ${status === "compatible" ? "text-success" : status === "incompatible" ? "text-danger" : "text-warning"}`}
        >
          {mod.compat?.reason
            ? reasonText(t, mod.compat.reason)
            : t(`mods.compat.${status}`)}
        </span>
      )}
    </div>
  );
}
