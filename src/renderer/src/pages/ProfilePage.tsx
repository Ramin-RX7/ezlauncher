import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { ModsTab } from "../components/mods/ModsTab";
import { DeleteProfileDialog } from "../components/profiles/DeleteProfileDialog";
import { ProfileEditor } from "../components/profiles/ProfileEditor";
import { WorldsTab } from "../components/profiles/WorldsTab";
import { Button } from "../components/ui/Button";
import { TabBar } from "../components/ui/Tabs";
import { useProfiles } from "../state/queries";

type Tab = "settings" | "worlds" | "mods";
const TABS: readonly Tab[] = ["settings", "worlds", "mods"];

export function ProfilePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams();
  const profiles = useProfiles();
  const [tab, setTab] = useState<Tab>("settings");
  const [deleting, setDeleting] = useState(false);
  const list = profiles.data ?? [];
  const profile = list.find((p) => p.id === id);

  if (profiles.isPending) return null;

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
            <h1 className="truncate text-lg font-semibold">{profile.name}</h1>
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
          {tab === "worlds" && <WorldsTab profile={profile} />}
          {tab === "mods" && <ModsTab profile={profile} />}
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
