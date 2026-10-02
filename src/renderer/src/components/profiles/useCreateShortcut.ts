import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Profile } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { useAppInfo } from "../../state/queries";
import { profileIconPng } from "./profileIconPng";

/** Make a desktop shortcut that opens the launcher on this profile. */
export function useCreateShortcut() {
  const { t } = useTranslation();
  const info = useAppInfo();
  const create = useMutation({
    mutationFn: async (profile: Profile) => {
      const iconPng = await profileIconPng(profile);
      return invoke("profiles:createShortcut", {
        profileId: profile.id,
        ...(iconPng && { iconPng }),
        description: t("shortcut.description", { name: profile.name }),
      });
    },
  });
  return { create, available: info.data?.canCreateShortcuts === true };
}
