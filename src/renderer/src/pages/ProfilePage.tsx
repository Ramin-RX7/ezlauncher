import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { ExportModpackDialog } from "../components/modpacks/ExportModpackDialog";
import { UpdateModpackDialog } from "../components/modpacks/UpdateModpackDialog";
import { ModsTab } from "../components/mods/ModsTab";
import { PlayBar, type PlayRequest } from "../components/play/PlayBar";
import { DeleteProfileDialog } from "../components/profiles/DeleteProfileDialog";
import { DuplicateProfileDialog } from "../components/profiles/DuplicateProfileDialog";
import { ProfileEditor } from "../components/profiles/ProfileEditor";
import { ProfileIcon } from "../components/profiles/ProfileIcon";
import { ServersTab } from "../components/profiles/ServersTab";
import { ShortcutButton } from "../components/profiles/ShortcutButton";
import { WorldsTab } from "../components/profiles/WorldsTab";
import { ResourcePacksTab } from "../components/resourcepacks/ResourcePacksTab";
import { ShadersTab } from "../components/shaders/ShadersTab";
import { Button } from "../components/ui/Button";
import { TabBar } from "../components/ui/Tabs";
import { useProfiles } from "../state/queries";

type Tab =
  "settings" | "worlds" | "servers" | "mods" | "resourcePacks" | "shaders";
const TABS: readonly Tab[] = [
  "settings",
  "worlds",
  "servers",
  "mods",
  "resourcePacks",
  "shaders",
];

export function ProfilePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams();
  const profiles = useProfiles();
  const [tab, setTab] = useState<Tab>("settings");
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [playRequest, setPlayRequest] = useState<PlayRequest>();
  const list = profiles.data ?? [];
  const profile = list.find((p) => p.id === id);

  if (profiles.isPending) return null;

  const play = (request: Omit<PlayRequest, "seq" | "profileId">) => {
    if (!profile) return;
    setPlayRequest((r) => ({
      ...request,
      profileId: profile.id,
      seq: (r?.seq ?? 0) + 1,
    }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <Link
        to="/"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted hover:text-text"
      >
        <ArrowLeft size={16} className="rtl:rotate-180" aria-hidden />
        {t("profiles.back")}
      </Link>
      {!profile ? (
        <p className="text-sm text-muted">{t("profiles.notFound")}</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <ProfileIcon profile={profile} />
              <div className="flex min-w-0 flex-col">
                <h1 className="truncate text-lg font-semibold">
                  {profile.name}
                </h1>
                {profile.modpack && (
                  <span className="truncate text-xs text-muted">
                    {t("modpacks.badge", {
                      name: profile.modpack.name,
                      version: profile.modpack.versionNumber,
                    })}
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {profile.modpack && (
                <Button
                  variant="ghost"
                  disabled={profile.running > 0}
                  onClick={() => {
                    setUpdating(true);
                  }}
                >
                  {t("modpacks.update.open")}
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  setExporting(true);
                }}
              >
                {t("modpacks.export.open")}
              </Button>
              <ShortcutButton profile={profile} />
              <Button
                variant="ghost"
                onClick={() => {
                  setDuplicating(true);
                }}
              >
                {t("profiles.duplicate")}
              </Button>
              <Button
                variant="ghost"
                className="text-danger"
                disabled={profile.running > 0}
                onClick={() => {
                  setDeleting(true);
                }}
              >
                {t("profiles.delete")}
              </Button>
            </div>
          </div>
          <PlayBar
            profile={profile}
            profiles={list}
            {...(playRequest && { request: playRequest })}
          />
          <TabBar
            label={profile.name}
            items={TABS.map((value) => ({
              value,
              label: t(`profiles.tabs.${value}`),
            }))}
            value={tab}
            onChange={setTab}
          />
          {tab === "settings" && (
            <ProfileEditor
              key={profile.id}
              profile={profile}
              running={profile.running > 0}
              onSaved={() => undefined}
            />
          )}
          {tab === "worlds" && (
            <WorldsTab
              profile={profile}
              onPlay={(w) => {
                play({
                  quickPlay: { kind: "world", worldId: w.id },
                  target: w.name,
                });
              }}
            />
          )}
          {tab === "servers" && (
            <ServersTab
              profile={profile}
              onJoin={(address, name) => {
                play({ quickPlay: { kind: "server", address }, target: name });
              }}
            />
          )}
          {tab === "mods" && <ModsTab profile={profile} />}
          {tab === "resourcePacks" && <ResourcePacksTab profile={profile} />}
          {tab === "shaders" && <ShadersTab profile={profile} />}
          {updating && (
            <UpdateModpackDialog
              profile={profile}
              onClose={() => {
                setUpdating(false);
              }}
            />
          )}
          {exporting && (
            <ExportModpackDialog
              profile={profile}
              onClose={() => {
                setExporting(false);
              }}
            />
          )}
          {duplicating && (
            <DuplicateProfileDialog
              profile={profile}
              onClose={() => {
                setDuplicating(false);
              }}
              onDuplicated={(copy) => {
                void navigate(`/profiles/${copy.id}`);
              }}
            />
          )}
          {deleting && (
            <DeleteProfileDialog
              profile={profile}
              profiles={list}
              onClose={() => {
                setDeleting(false);
              }}
              onDeleted={() => {
                void navigate("/");
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
