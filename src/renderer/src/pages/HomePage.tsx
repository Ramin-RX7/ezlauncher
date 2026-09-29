import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { GameLog } from "../components/play/GameLog";
import { PlayBar } from "../components/play/PlayBar";
import { DeleteProfileDialog } from "../components/profiles/DeleteProfileDialog";
import { OrphanWorlds } from "../components/profiles/OrphanWorlds";
import { ProfileList } from "../components/profiles/ProfileList";
import { invoke } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { useLauncherState } from "../state/launcherStore";
import { useLoaders, useProfiles, useSelection } from "../state/queries";

export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profiles = useProfiles();
  const loaders = useLoaders();
  const { profileId, selectProfile } = useSelection();
  const list = useMemo(() => profiles.data ?? [], [profiles.data]);
  const selected = list.find((p) => p.id === profileId);
  const [deleting, setDeleting] = useState<string>();
  const [actionError, setActionError] = useState<string>();

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

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{t("profiles.title")}</h1>
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

      <div className="min-h-0 flex-1 overflow-auto">
        {list.length > 0 && (
          <ProfileList
            profiles={list}
            selectedId={selected?.id ?? null}
            loaderNames={loaderNames}
            onSelect={selectProfile}
            onEdit={(id) => {
              void navigate(`/profiles/${id}`);
            }}
            onOpenFolder={(id) => {
              setActionError(undefined);
              invoke("profiles:openFolder", id).catch((err: unknown) => {
                setActionError(errorMessage(t, err));
              });
            }}
            onDelete={setDeleting}
          />
        )}
      </div>

      <OrphanWorlds />
      <PlayBar profile={selected} profiles={list} />
      <GameLog
        open={logOpen}
        onToggle={() => {
          setLogChoice(!logOpen);
        }}
      />

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
