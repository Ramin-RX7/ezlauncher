import type {
  ActivePackRef,
  PackDownloadProgress,
  PackInstallResult,
  Profile,
  ProfilePacks,
} from "@shared/launcher";
import { AppError } from "../core/errors";
import { RESOURCE_PACK_DOWNLOAD } from "../modsources/downloadPack";
import type { PackLibrary } from "../profiles/packs/library";
import type { GameFormat } from "../profiles/packs/packFormat";
import { packCompat } from "../profiles/packs/packMeta";
import {
  activePacksSchema,
  type ProfilePacksApi,
} from "../profiles/packs/profilePacks";
import { createPackKindService, type PackServiceDeps } from "./packs";

export interface ResourcePackServiceDeps extends PackServiceDeps {
  library: PackLibrary;
  profilePacks: ProfilePacksApi;
  gameFormat: (profile: Profile) => Promise<GameFormat | undefined>;
  progress: (p: PackDownloadProgress) => void;
}

/** Resource packs (Scope 08): a shared library, turned on per profile in its `options.txt`. */
export function createResourcePackService(deps: ResourcePackServiceDeps) {
  const { library, profilePacks, runtime, requireProfile, changed } = deps;
  const { serialFs, isBusy, assertNotRunning } = runtime;

  /** Turn library packs on in a profile, at the top (highest priority). */
  async function activatePacks(
    profile: Profile,
    sha1s: readonly string[],
  ): Promise<void> {
    const view = await profilePacks.view(profile, { running: false });
    if (view.locked === "unsupported")
      throw new AppError(
        "PACKS_UNSUPPORTED",
        "This version uses texture packs.",
      );
    if (view.locked)
      throw new AppError(
        "PACKS_VERSION_UNKNOWN",
        "Install or launch this profile once first.",
      );
    const current: ActivePackRef[] = view.active.map((row) =>
      row.kind === "builtin" ? row : row.pack.ref,
    );
    const fresh = sha1s.filter(
      (sha1) => !current.some((r) => r.kind === "library" && r.sha1 === sha1),
    );
    await serialFs(() =>
      profilePacks.setActive(profile, [
        ...fresh.map((sha1) => ({ kind: "library" as const, sha1 })),
        ...current,
      ]),
    );
  }

  const service = createPackKindService<Profile, PackInstallResult>(deps, {
    library,
    download: RESOURCE_PACK_DOWNLOAD,
    inUse: { code: "PACK_IN_USE", message: "Profiles still use this pack." },
    busyMessage: "This pack is already downloading.",
    target: requireProfile,
    gameVersion: (profile) => profile.gameVersion,
    progress: deps.progress,
    projectIcon: false,
    async addTo(profile, sha1s) {
      if (isBusy(profile.id))
        throw new AppError("GAME_RUNNING", "Close the game first.");
      await activatePacks(profile, sha1s);
    },
    assertUsersIdle(users) {
      for (const id of users) assertNotRunning(id);
      return Promise.resolve();
    },
    async result({ target, meta, placed, base, download }) {
      const format = target ? await deps.gameFormat(target) : undefined;
      return {
        ...base,
        compat: packCompat(meta?.range, format?.resource),
        activated: placed,
        needs: download.needs,
      };
    },
  });

  return {
    service,
    api: {
      packLibrary: service.list,
      packIcon: service.icon,

      async packFolderIcon(
        profileId: string,
        name: string,
      ): Promise<string | null> {
        await requireProfile(profileId);
        if (typeof name !== "string") return null;
        return profilePacks.folderIcon(profileId, name).catch(() => null);
      },

      /** A profile's Resource packs tab: active packs in order, the rest, and non-packs. */
      async profilePacks(profileId: string): Promise<ProfilePacks> {
        const profile = await requireProfile(profileId);
        const busy = isBusy(profileId);
        if (!busy) await deps.sync([profileId]);
        return profilePacks.view(profile, { running: busy });
      },

      /**
       * Save a profile's active packs (highest priority first) to its options.txt.
       * Never while a game of it runs or starts: the game would overwrite it.
       */
      async setActivePacks(profileId: string, order: unknown): Promise<void> {
        const profile = await requireProfile(profileId);
        assertNotRunning(profileId);
        const parsed = activePacksSchema.safeParse(order);
        if (!parsed.success)
          throw new AppError("PACK_NOT_FOUND", "That pack list isn't valid.");
        await serialFs(() => profilePacks.setActive(profile, parsed.data));
        changed();
      },

      /** Add pack zips to the library; with a profile, also turn them on there (at the top). */
      addPacks: service.add,
      /** Delete a pack from the library and every profile (`force` when profiles have it). */
      removePack: service.remove,
      removeUnusedPacks: service.removeUnused,
      /** Packs on the mod sites matching `query`, for the profile's Minecraft version if given. */
      searchPacks: service.search,
      /** Download a pack into the library; with a profile, turn it on there (at the top). */
      installPack: service.install,
      cancelPackInstall: service.cancelInstall,
    },
  };
}
