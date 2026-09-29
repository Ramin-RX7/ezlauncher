import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ProfileEditor } from "../components/profiles/ProfileEditor";
import { useProfiles, useSelection } from "../state/queries";

export function NewProfilePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profiles = useProfiles();
  const { selectProfile } = useSelection();
  const hasProfiles = (profiles.data?.length ?? 0) > 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <h1 className="text-lg font-semibold">
        {t("profiles.editor.createTitle")}
      </h1>
      <ProfileEditor
        onSaved={(profile) => {
          selectProfile(profile.id);
          void navigate("/");
        }}
        {...(hasProfiles && {
          onCancel: () => {
            void navigate("/");
          },
        })}
      />
    </div>
  );
}
