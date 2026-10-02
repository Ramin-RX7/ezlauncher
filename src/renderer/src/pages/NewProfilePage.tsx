import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import type { Profile } from "@shared/launcher";
import { ImportModpack } from "../components/modpacks/ImportModpack";
import { ProfileEditor } from "../components/profiles/ProfileEditor";
import { TabBar } from "../components/ui/Tabs";
import { useProfiles, useSelection } from "../state/queries";

type Mode = "empty" | "modpack";

export function NewProfilePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profiles = useProfiles();
  const { selectProfile } = useSelection();
  const hasProfiles = (profiles.data?.length ?? 0) > 0;
  const [mode, setMode] = useState<Mode>("empty");
  const done = (profile: Profile) => {
    selectProfile(profile.id);
    void navigate("/");
  };
  const cancel = hasProfiles
    ? () => {
        void navigate("/");
      }
    : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <h1 className="text-lg font-semibold">
        {t("profiles.editor.createTitle")}
      </h1>
      <TabBar
        label={t("profiles.editor.createTitle")}
        items={[
          { value: "empty", label: t("modpacks.newProfile.empty") },
          { value: "modpack", label: t("modpacks.newProfile.fromPack") },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === "empty" ? (
        <ProfileEditor onSaved={done} {...(cancel && { onCancel: cancel })} />
      ) : (
        <ImportModpack
          onImported={done}
          {...(cancel && { onCancel: cancel })}
        />
      )}
    </div>
  );
}
