import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Image, Plus, Search } from "lucide-react";
import {
  PROFILE_SORTS,
  type LauncherSettings,
  type ProfileInfo,
  type ProfileSort,
} from "@shared/launcher";
import { GameLog } from "../components/play/GameLog";
import { PlayBar, type PlayRequest } from "../components/play/PlayBar";
import { DeleteProfileDialog } from "../components/profiles/DeleteProfileDialog";
import { DuplicateProfileDialog } from "../components/profiles/DuplicateProfileDialog";
import { OrphanWorlds } from "../components/profiles/OrphanWorlds";
import {
  ProfileList,
  type ProfileListProps,
} from "../components/profiles/ProfileList";
import { sortProfiles } from "../components/profiles/sortProfiles";
import { useCreateShortcut } from "../components/profiles/useCreateShortcut";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { invoke } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { useCopyDiagnostics } from "../lib/useCopyDiagnostics";
import { useLauncherState } from "../state/launcherStore";
import {
  keys,
  useAccounts,
  useLoaders,
  useProfiles,
  useSelection,
  useSettings,
} from "../state/queries";

export function HomePage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const settings = useSettings();
  const sort = settings.data?.profileSort ?? "lastPlayed";
  const setSort = useMutation({
    mutationFn: (profileSort: ProfileSort) =>
      invoke("settings:update", { profileSort }),
    onMutate: (profileSort) => {
      queryClient.setQueryData<LauncherSettings>(keys.settings, (old) =>
        old ? { ...old, profileSort } : old,
      );
    },
  });
  const navigate = useNavigate();
  const profiles = useProfiles();
  const loaders = useLoaders();
  const { profileId, selectProfile, accountId } = useSelection();
  const accounts = useAccounts();
  const account = accounts.data?.find((a) => a.id === accountId);
  const runningGames = useLauncherState((s) => s.running);
  const [playRequest, setPlayRequest] = useState<PlayRequest>();
  const list = useMemo(() => profiles.data ?? [], [profiles.data]);
  const selected = list.find((p) => p.id === profileId);
  const [deleting, setDeleting] = useState<string>();
  const [duplicating, setDuplicating] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const shortcut = useCreateShortcut();
  const diagnostics = useCopyDiagnostics();

  // First start (or every profile deleted): go straight to creating one.
  useEffect(() => {
    if (profiles.isSuccess && profiles.data.length === 0)
      void navigate("/profiles/new", { replace: true });
  }, [profiles.isSuccess, profiles.data, navigate]);

  const loaderNames = useMemo(
    () =>
      Object.fromEntries(
        (loaders.data ?? []).map((l) => [l.id, l.displayName]),
      ),
    [loaders.data],
  );

  // The log opens by itself while a game runs or after a crash, until the user toggles it.
  const [logChoice, setLogChoice] = useState<boolean>();
  const autoOpen = useLauncherState(
    (s) => s.running.length > 0 || s.lastExit?.crashed === true,
  );
  const logOpen = logChoice ?? autoOpen;
  const deletingProfile = list.find((p) => p.id === deleting);
  const duplicatingProfile = list.find((p) => p.id === duplicating);

  // Search by name, Minecraft version, loader or mod pack.
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? list.filter((p) =>
        [
          p.name,
          p.gameVersion,
          p.loader ? (loaderNames[p.loader.id] ?? p.loader.id) : undefined,
          p.modpack?.name,
        ].some((text) => text?.toLowerCase().includes(q)),
      )
    : list;
  const { pinned, others } = sortProfiles(shown, sort, i18n.language);

  const pin = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      invoke("profiles:setPinned", { id, pinned }),
    onMutate: ({ id, pinned }) => {
      queryClient.setQueryData<ProfileInfo[]>(keys.profiles, (old) =>
        old?.map((p) => (p.id === id ? { ...p, pinned } : p)),
      );
    },
    onError: (err) => {
      setActionError(errorMessage(t, err));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.profiles });
    },
  });

  const openScreenshots = () => {
    setActionError(undefined);
    invoke("screenshots:openFolder").catch((err: unknown) => {
      setActionError(errorMessage(t, err));
    });
  };

  const listProps: Omit<ProfileListProps, "profiles"> = {
    selectedId: selected?.id ?? null,
    loaderNames,
    onSelect: selectProfile,
    onEdit: (id) => {
      void navigate(`/profiles/${id}`);
    },
    onPlay: (id) => {
      selectProfile(id);
      setPlayRequest((r) => ({
        profileId: id,
        seq: (r?.seq ?? 0) + 1,
      }));
    },
    playBlocked: (p) => {
      if (!account) return t("play.needAccount");
      if (
        runningGames.some(
          (g) => g.profileId === p.id && g.accountId === account.id,
        )
      )
        return t("play.accountPlaying", { name: account.username });
      return undefined;
    },
    onDuplicate: setDuplicating,
    onOpenFolder: (id, folder) => {
      setActionError(undefined);
      invoke("profiles:openFolder", id, folder).catch((err: unknown) => {
        setActionError(errorMessage(t, err));
      });
    },
    onOpenScreenshots: () => {
      openScreenshots();
    },
    onCopyDiagnostics: (id) => {
      setActionError(undefined);
      diagnostics.mutate(id);
    },
    onPin: (id, pinned) => {
      setActionError(undefined);
      pin.mutate({ id, pinned });
    },
    ...(shortcut.available && {
      onShortcut: (id: string) => {
        const p = list.find((x) => x.id === id);
        if (p) shortcut.create.mutate(p);
      },
    }),
    onDelete: setDeleting,
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{t("profiles.title")}</h1>
        {list.length > 0 && (
          <div className="relative me-auto">
            <Search
              size={16}
              className="pointer-events-none absolute start-2.5 top-2.5 text-muted"
            />
            <Input
              type="search"
              aria-label={t("profiles.search")}
              placeholder={t("profiles.search")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              className="w-64 ps-8"
            />
          </div>
        )}
        {list.length > 1 && (
          <Select<ProfileSort>
            aria-label={t("profiles.sortLabel")}
            value={sort}
            options={PROFILE_SORTS.map((s) => ({
              value: s,
              label: t(`profiles.sort.${s}`),
            }))}
            onChange={(value) => {
              setSort.mutate(value);
            }}
            className="w-40"
          />
        )}
        {list.length > 0 && (
          <button
            type="button"
            onClick={openScreenshots}
            title={t("profiles.openScreenshots")}
            className="inline-flex items-center gap-2 rounded-ezl border border-border bg-surface-2 px-3 py-2 text-sm hover:border-muted"
          >
            <Image size={16} aria-hidden />
            {t("profiles.screenshots")}
          </button>
        )}
        <Link
          to="/profiles/new"
          className="inline-flex items-center gap-2 rounded-ezl border border-border bg-surface-2 px-4 py-2 text-sm font-medium hover:border-muted"
        >
          <Plus size={16} aria-hidden />
          {t("profiles.new")}
        </Link>
      </div>

      {actionError && (
        <p role="alert" className="text-sm text-danger">
          {actionError}
        </p>
      )}
      {diagnostics.isSuccess && (
        <p role="status" className="text-sm text-success">
          {t("diagnostics.copied")}
        </p>
      )}
      {diagnostics.isError && (
        <p role="alert" className="text-sm text-danger">
          {t("diagnostics.failed", {
            error: errorMessage(t, diagnostics.error),
          })}
        </p>
      )}
      {shortcut.create.isSuccess && (
        <p role="status" className="text-sm text-success">
          {t("shortcut.created")}
        </p>
      )}
      {shortcut.create.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, shortcut.create.error)}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {list.length > 0 && shown.length === 0 && (
          <p className="rounded-ezl border border-border bg-surface p-6 text-center text-sm text-muted">
            {t("profiles.noMatch")}
          </p>
        )}
        {pinned.length > 0 && (
          <section className="mb-4 flex flex-col gap-2">
            <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">
              {t("profiles.pinned")}
            </h2>
            <ProfileList
              {...listProps}
              profiles={pinned}
              label={t("profiles.pinned")}
            />
          </section>
        )}
        {others.length > 0 && (
          <section className="flex flex-col gap-2">
            {pinned.length > 0 && (
              <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">
                {t("profiles.others")}
              </h2>
            )}
            <ProfileList {...listProps} profiles={others} />
          </section>
        )}
      </div>

      <OrphanWorlds />
      <PlayBar
        profile={selected}
        profiles={list}
        {...(playRequest && { request: playRequest })}
      />
      <GameLog
        open={logOpen}
        onToggle={() => {
          setLogChoice(!logOpen);
        }}
      />

      {duplicatingProfile && (
        <DuplicateProfileDialog
          profile={duplicatingProfile}
          onClose={() => {
            setDuplicating(undefined);
          }}
          onDuplicated={(copy) => {
            selectProfile(copy.id);
          }}
        />
      )}
      {deletingProfile && (
        <DeleteProfileDialog
          profile={deletingProfile}
          profiles={list}
          onClose={() => {
            setDeleting(undefined);
          }}
        />
      )}
    </div>
  );
}
