import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Plus, Search } from "lucide-react";
import { GameLog } from "../components/play/GameLog";
import { PlayBar, type PlayRequest } from "../components/play/PlayBar";
import { DeleteProfileDialog } from "../components/profiles/DeleteProfileDialog";
import { DuplicateProfileDialog } from "../components/profiles/DuplicateProfileDialog";
import { OrphanWorlds } from "../components/profiles/OrphanWorlds";
import { ProfileList } from "../components/profiles/ProfileList";
import { useCreateShortcut } from "../components/profiles/useCreateShortcut";
import { Input } from "../components/ui/Input";
import { invoke } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { useLauncherState } from "../state/launcherStore";
import {
  useAccounts,
  useLoaders,
  useProfiles,
  useSelection,
} from "../state/queries";

export function HomePage() {
  const { t } = useTranslation();
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

  // Search by name, Minecraft version or loader.
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? list.filter((p) =>
        [
          p.name,
          p.gameVersion,
          p.loader ? (loaderNames[p.loader.id] ?? p.loader.id) : undefined,
        ].some((text) => text?.toLowerCase().includes(q)),
      )
    : list;

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
        {shown.length > 0 && (
          <ProfileList
            profiles={shown}
            selectedId={selected?.id ?? null}
            loaderNames={loaderNames}
            onSelect={selectProfile}
            onEdit={(id) => {
              void navigate(`/profiles/${id}`);
            }}
            onPlay={(id) => {
              selectProfile(id);
              setPlayRequest((r) => ({
                profileId: id,
                seq: (r?.seq ?? 0) + 1,
              }));
            }}
            playBlocked={(p) => {
              if (!account) return t("play.needAccount");
              if (
                runningGames.some(
                  (g) => g.profileId === p.id && g.accountId === account.id,
                )
              )
                return t("play.accountPlaying", { name: account.username });
              return undefined;
            }}
            onDuplicate={setDuplicating}
            onOpenFolder={(id, folder) => {
              setActionError(undefined);
              invoke("profiles:openFolder", id, folder).catch(
                (err: unknown) => {
                  setActionError(errorMessage(t, err));
                },
              );
            }}
            {...(shortcut.available && {
              onShortcut: (id: string) => {
                const p = list.find((x) => x.id === id);
                if (p) shortcut.create.mutate(p);
              },
            })}
            onDelete={setDeleting}
          />
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
