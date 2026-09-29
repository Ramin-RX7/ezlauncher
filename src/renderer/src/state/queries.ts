import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LauncherSettings } from "@shared/launcher";
import { invoke } from "../lib/api";

/** Query keys shared by pages, so events can refresh them. */
export const keys = {
  profiles: ["profiles"] as const,
  worlds: (profileId: string) => ["worlds", profileId] as const,
  orphans: ["worlds", "orphans"] as const,
  installed: ["versions", "installed"] as const,
  versions: ["versions"] as const,
  loaders: ["loaders"] as const,
  accounts: ["accounts"] as const,
  settings: ["settings"] as const,
};

export function useProfiles() {
  return useQuery({
    queryKey: keys.profiles,
    queryFn: () => invoke("profiles:list"),
  });
}

export function useLoaders() {
  return useQuery({
    queryKey: keys.loaders,
    queryFn: () => invoke("loaders:list", {}),
  });
}

export function useVersionList() {
  return useQuery({
    queryKey: keys.versions,
    queryFn: () => invoke("versions:list", {}),
  });
}

export function useAccounts() {
  return useQuery({
    queryKey: keys.accounts,
    queryFn: () => invoke("account:list"),
  });
}

export function useSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: () => invoke("settings:get"),
  });
}

/** The profile and account picked on the home screen, remembered in the settings. */
export function useSelection() {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const update = useMutation({
    mutationFn: (
      patch: Pick<
        Partial<LauncherSettings>,
        "selectedProfileId" | "selectedAccountId"
      >,
    ) => invoke("settings:update", patch),
    onMutate: (patch) => {
      // Show the choice at once; the saved settings follow.
      queryClient.setQueryData<LauncherSettings>(keys.settings, (old) =>
        old ? { ...old, ...patch } : old,
      );
    },
    onSuccess: (next) => {
      queryClient.setQueryData(keys.settings, next);
    },
  });
  return {
    profileId: settings.data?.selectedProfileId ?? null,
    accountId: settings.data?.selectedAccountId ?? null,
    loaded: settings.isSuccess,
    selectProfile: (id: string | null) => {
      update.mutate({ selectedProfileId: id });
    },
    selectAccount: (id: string | null) => {
      update.mutate({ selectedAccountId: id });
    },
  };
}
