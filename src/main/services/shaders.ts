import type {
  PackDownloadProgress,
  PackRef,
  Profile,
  ProfileShaders,
  ShaderInstallResult,
} from "@shared/launcher";
import { AppError } from "../core/errors";
import { SHADER_DOWNLOAD } from "../modsources/downloadPack";
import type { PackLibrary } from "../profiles/packs/library";
import {
  shaderRefSchema,
  type ProfileShadersApi,
} from "../profiles/packs/profileShaders";
import { createPackKindService, type PackServiceDeps } from "./packs";

export interface ShaderServiceDeps extends PackServiceDeps {
  library: PackLibrary;
  profileShaders: ProfileShadersApi;
  /** Whether a profile has a mod turned on (by its id, what it provides, or one inside it). */
  hasMod: (profileId: string, modId: string) => Promise<boolean>;
  progress: (p: PackDownloadProgress) => void;
}

/** Shader packs: a shared library; the active one lives in Iris's `config/iris.properties`. */
export function createShaderService(deps: ShaderServiceDeps) {
  const { library, profileShaders, runtime, requireProfile, changed } = deps;
  const { serialFs, isBusy, assertNotRunning } = runtime;

  const service = createPackKindService<Profile, ShaderInstallResult>(deps, {
    library,
    download: SHADER_DOWNLOAD,
    inUse: {
      code: "SHADER_IN_USE",
      message: "Profiles still use this shader.",
    },
    busyMessage: "This shader is already downloading.",
    target: requireProfile,
    gameVersion: (profile) => profile.gameVersion,
    progress: deps.progress,
    projectIcon: true,
    async addTo(profile, sha1s) {
      if (isBusy(profile.id))
        throw new AppError("GAME_RUNNING", "Close the game first.");
      await serialFs(async () => {
        for (const sha1 of sha1s) await profileShaders.add(profile, sha1);
      });
    },
    // A downloaded shader becomes the profile's active one (only with a mod loader).
    async placeDownloaded(profile, sha1) {
      if (profile.loader === null || isBusy(profile.id))
        throw new AppError("GAME_RUNNING", "Close the game first.");
      await serialFs(() =>
        profileShaders.setActive(profile, { kind: "library", sha1 }),
      );
    },
    assertUsersIdle(users) {
      for (const id of users) assertNotRunning(id);
      return Promise.resolve();
    },
    async beforeRemove(users, sha1) {
      for (const id of users) {
        const profile = await deps.profiles.get(id);
        if (profile) await profileShaders.remove(profile, sha1);
      }
    },
    async result({ target, placed, base, download }) {
      return {
        ...base,
        irisTagged: download.version.loaders.includes("iris"),
        activated: placed,
        irisMissing:
          target !== undefined &&
          target.loader !== null &&
          !(await deps.hasMod(target.id, "iris")),
      };
    },
  });

  return {
    service,
    api: {
      shaderLibrary: service.list,
      shaderIcon: service.icon,

      /** A profile's Shaders tab: the active shader, its shaders, the library's, and Iris. */
      async profileShaders(profileId: string): Promise<ProfileShaders> {
        const profile = await requireProfile(profileId);
        const busy = isBusy(profileId);
        if (!busy) await deps.sync([profileId]);
        return profileShaders.view(profile, {
          running: busy,
          hasIris:
            profile.loader !== null && (await deps.hasMod(profileId, "iris")),
        });
      },

      /**
       * Make a shader the profile's active one, or turn shaders off (`null`). Never
       * while a game of it runs or starts: Iris rewrites its config on start.
       */
      async setActiveShader(profileId: string, ref: unknown): Promise<void> {
        const profile = await requireProfile(profileId);
        assertNotRunning(profileId);
        let parsed: PackRef | null = null;
        if (ref !== null) {
          const result = shaderRefSchema.safeParse(ref);
          if (!result.success)
            throw new AppError("SHADER_NOT_FOUND", "That shader isn't valid.");
          parsed = result.data;
        }
        const chosen = parsed;
        await serialFs(() => profileShaders.setActive(profile, chosen));
        changed();
      },

      /** Put a library shader in a profile, or take it out (`present: false`). */
      async setShaderInProfile(
        profileId: string,
        sha1: string,
        present: boolean,
      ): Promise<void> {
        const profile = await requireProfile(profileId);
        assertNotRunning(profileId);
        if (typeof sha1 !== "string" || !/^[0-9a-f]{40}$/.test(sha1))
          throw new AppError("SHADER_NOT_FOUND", "That shader isn't valid.");
        await serialFs(() =>
          present
            ? profileShaders.add(profile, sha1)
            : profileShaders.remove(profile, sha1),
        );
        changed();
      },

      /** Add shader zips to the library; with a profile, also put them there. */
      addShaders: service.add,
      /** Delete a shader from the library and every profile (`force` when profiles have it). */
      removeShader: service.remove,
      removeUnusedShaders: service.removeUnused,
      /** Shaders on the mod sites matching `query`, for the profile's Minecraft version if given. */
      searchShaders: service.search,
      /** Download a shader into the library; with a profile, make it the active one there. */
      installShader: service.install,
      cancelShaderInstall: service.cancelInstall,
    },
  };
}
