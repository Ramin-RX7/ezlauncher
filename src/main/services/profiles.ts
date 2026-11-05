import { mkdir, readFile, rm } from "node:fs/promises";
import type {
  DeleteWorldsChoice,
  OrphanWorld,
  Profile,
  ProfileInfo,
  WorldInfo,
} from "@shared/launcher";
import { PROFILE_NAME_MAX } from "@shared/launcher";
import { AppError } from "../core/errors";
import type { Logger } from "../core/logger";
import type { Paths } from "../minecraft/paths";
import type { ModLibrary } from "../profiles/mods";
import { imageType, type PackLibrary } from "../profiles/packs/library";
import type { ProfilePacksApi } from "../profiles/packs/profilePacks";
import type { ProfileShadersApi } from "../profiles/packs/profileShaders";
import type { PlayTime } from "../profiles/playTime";
import type { ProfileStore } from "../profiles/profiles";
import { removeTree } from "../profiles/links";
import {
  copyProfileWorlds,
  deleteWorld,
  listOrphans,
  listWorlds,
  moveWorld,
  readWorldOwner,
  rescueUnlinkedWorlds,
  worldsOwnedBy,
} from "../profiles/worlds";
import type { createSettingsStore } from "../settings/settings";
import type { createProfileShortcut } from "../shortcuts";
import type { ModpackService } from "./modpacks";
import type { Runtime } from "./runtime";

export interface ProfileServiceDeps {
  paths: Paths;
  profiles: ProfileStore;
  mods: ModLibrary;
  /** Data packs: keyed by world, so a deleted profile's worlds forget theirs. */
  dataPacks: Pick<PackLibrary, "forgetProfile">;
  profilePacks: ProfilePacksApi;
  profileShaders: ProfileShadersApi;
  modpacks: Pick<ModpackService, "copyTo" | "forgetProfile">;
  playTime: Pick<PlayTime, "totals" | "forget">;
  settings: Pick<ReturnType<typeof createSettingsStore>, "load" | "update">;
  runtime: Runtime;
  /** Resolves once startup (migration, first sync) is done. */
  whenReady: () => Promise<void>;
  requireProfile: (id: string) => Promise<Profile>;
  /** World, mod and pack sync for some (default: all) profiles. */
  sync: (only?: string[]) => Promise<void>;
  changed: () => void;
  /** Throws `LOADER_UNKNOWN` for a loader id no provider has. */
  validateLoader: (loader: unknown) => void;
  /** Every profile id, and which ones run (for world moves). */
  worldOptions: () => Promise<{
    profileIds: string[];
    isRunning: (id: string) => boolean;
  }>;
  /** A profile's worlds with their newest backup. */
  worldsWithBackups: (profileId: string) => Promise<WorldInfo[]>;
  /** Take a profile out of the mod, resource pack and shader libraries (its links). */
  forgetInLibraries: (profileId: string) => Promise<void>;
  openFolder: (dir: string) => Promise<void>;
  createShortcut: typeof createProfileShortcut;
  logger: Logger;
}

/** Profiles (create, duplicate, update, delete, pin, shortcut, icon) and their worlds. */
export function createProfileService(deps: ProfileServiceDeps) {
  const {
    paths,
    profiles,
    mods,
    dataPacks,
    profilePacks,
    profileShaders,
    modpacks,
    playTime,
    settings,
    whenReady,
    requireProfile,
    sync,
    changed,
    validateLoader,
    worldOptions,
    forgetInLibraries,
    openFolder,
  } = deps;
  const { running, serialFs, assertNotRunning } = deps.runtime;
  const log = deps.logger;

  const api = {
    async listProfiles(): Promise<ProfileInfo[]> {
      await whenReady();
      const played = await playTime
        .totals()
        .catch(() => new Map<string, number>());
      return (await profiles.list()).map((p) => ({
        ...p,
        playTimeMs: played.get(p.id) ?? 0,
        running: [...running.values()].filter((g) => g.profileId === p.id)
          .length,
      }));
    },

    async createProfile(input: unknown): Promise<Profile> {
      await whenReady();
      validateLoader((input as { loader?: unknown } | null)?.loader);
      const profile = await profiles.create(input);
      await mkdir(paths.gameDir(profile.id), { recursive: true });
      changed();
      return profile;
    },

    /**
     * Copy a profile's settings and enabled mods into a new one (new id). Worlds are
     * owned by id, so the copy starts with none unless `copyWorlds`: then each world
     * is copied and the copies belong to the new profile (the originals are untouched).
     * The install is not copied: the next Play verifies it (version files are shared).
     */
    async duplicateProfile(
      id: string,
      options: { copyWorlds?: boolean } = {},
    ): Promise<Profile> {
      const src = await requireProfile(id);
      const copyWorlds = options.copyWorlds === true;
      // A running game keeps writing its worlds: copying now would catch them half-saved.
      if (copyWorlds) assertNotRunning(id);
      const suffix = " (copy)";
      const name = `${src.name.slice(0, PROFILE_NAME_MAX - suffix.length)}${suffix}`;
      const profile = await profiles.create({
        name,
        gameVersion: src.gameVersion,
        loader: src.loader,
        ...(src.iconId !== undefined && { iconId: src.iconId }),
        ...(src.memoryMaxMb !== undefined && { memoryMaxMb: src.memoryMaxMb }),
        ...(src.extraJvmArgs !== undefined && {
          extraJvmArgs: src.extraJvmArgs,
        }),
        ...(src.extraGameArgs !== undefined && {
          extraGameArgs: src.extraGameArgs,
        }),
        ...(src.gameWindow !== undefined && { gameWindow: src.gameWindow }),
      });
      await mkdir(paths.gameDir(profile.id), { recursive: true });
      const sha1s = (await mods.enabledMods(id)).map((m) => m.sha1);
      if (sha1s.length > 0)
        await serialFs(() => mods.enableAll(profile.id, sha1s));
      // A mod pack's profile stays one: its pack record, icon and config files come too.
      await serialFs(() => modpacks.copyTo(src, profile)).catch(
        (err: unknown) => {
          log.warn(`copying the mod pack files of ${id} failed`, err);
        },
      );
      // The same active resource packs, in the same order (only those lines of options.txt).
      await serialFs(() => profilePacks.copyActive(src, profile)).catch(
        (err: unknown) => {
          log.warn(`copying the resource packs of ${id} failed`, err);
        },
      );
      // The same shaders with their options, and the same active one.
      await serialFs(() => profileShaders.copyTo(src, profile)).catch(
        (err: unknown) => {
          log.warn(`copying the shaders of ${id} failed`, err);
        },
      );
      if (copyWorlds) {
        try {
          const count = await serialFs(() =>
            copyProfileWorlds(paths, id, profile.id),
          );
          log.info(`copied ${count} worlds from ${id} to ${profile.id}`);
        } catch (err) {
          // Nothing half-made: the new profile goes again, the originals were only read.
          await serialFs(async () => {
            await forgetInLibraries(profile.id);
            await removeTree(paths.gameDir(profile.id)).catch(() => undefined);
            await profiles.remove(profile.id);
          });
          changed();
          throw err;
        }
        await sync([profile.id]); // adopts the copies into worlds/, owned by the copy
      }
      changed();
      return profile;
    },

    async setProfilePinned(id: string, pinned: boolean): Promise<void> {
      await profiles.setPinned(id, pinned);
      changed();
    },

    async updateProfile(id: string, patch: unknown): Promise<Profile> {
      const before = await requireProfile(id);
      assertNotRunning(id);
      validateLoader((patch as { loader?: unknown } | null)?.loader);
      const profile = await profiles.update(id, patch);
      if (profile.gameVersion !== before.gameVersion) {
        // Across 1.13 the game names resource packs differently in options.txt.
        const [from, to] = await Promise.all([
          profilePacks.dialectOf(before),
          profilePacks.dialectOf(profile),
        ]);
        if (from && to && from !== to)
          await serialFs(() => profilePacks.translate(profile, from, to)).catch(
            (err: unknown) => {
              log.warn(`updating ${id}'s resource packs failed`, err);
            },
          );
      }
      changed();
      return profile;
    },

    /** Delete a profile. Its worlds are deleted or moved to another profile, as chosen. */
    async deleteProfile(id: string, worlds: DeleteWorldsChoice): Promise<void> {
      await requireProfile(id);
      assertNotRunning(id);
      const moveTo = typeof worlds === "object" ? worlds.moveTo : undefined;
      if (moveTo !== undefined) {
        if (moveTo === id)
          throw new AppError("INVALID_PROFILE", "Pick another profile.");
        await requireProfile(moveTo);
        assertNotRunning(moveTo);
      } else if (worlds !== "delete") {
        throw new AppError(
          "INVALID_PROFILE",
          "Choose what to do with the worlds.",
        );
      }

      await serialFs(async () => {
        if (moveTo) {
          // First the worlds still sitting in saves/ (made in game, not synced yet),
          // so they go to the new owner too.
          await rescueUnlinkedWorlds(paths, id, moveTo);
          const options = await worldOptions();
          for (const worldId of await worldsOwnedBy(paths, id))
            await moveWorld({ paths, logger: log }, worldId, moveTo, options);
        } else {
          const owned = await worldsOwnedBy(paths, id);
          for (const worldId of owned) {
            await deleteWorld(paths, worldId);
            await dataPacks.forgetProfile(worldId); // a moved world keeps its packs
          }
        }
        await profiles.remove(id);
        // Never follows links, so worlds linked into this profile can't be touched.
        // Its mods are hard links: the library keeps them.
        await removeTree(paths.gameDir(id));
        await forgetInLibraries(id);
        await modpacks.forgetProfile(id);
        await playTime.forget(id);
        await removeTree(paths.modpackBackupsDir(id)).catch(() => undefined);
        // Its desktop shortcut stays (it opens a "doesn't exist" page); its icon goes.
        for (const ext of ["ico", "png"] as const)
          await rm(paths.shortcutIcon(id, ext), { force: true });
      });
      if (moveTo) await sync([moveTo]);
      const current = await settings.load();
      if (current.selectedProfileId === id)
        await settings.update({ selectedProfileId: null });
      changed();
    },

    /** A desktop shortcut that opens the launcher on this profile; resolves to its path. */
    async createShortcut(
      id: string,
      options: { iconPng?: unknown; description?: unknown },
    ): Promise<string> {
      const profile = await requireProfile(id);
      const description =
        typeof options.description === "string" ? options.description : "";
      const path = await deps.createShortcut({
        paths,
        profile,
        iconPng: options.iconPng,
        description,
      });
      log.info(`made a desktop shortcut for ${profile.id}: ${path}`);
      return path;
    },

    /** A profile's own picture (a mod pack's icon) as a `data:` URL, or null. */
    async profileIcon(id: string): Promise<string | null> {
      const profile = await requireProfile(id);
      if (!profile.customIcon) return null;
      try {
        const bytes = await readFile(paths.profileIcon(profile.id));
        const type = imageType(bytes);
        return type ? `data:${type};base64,${bytes.toString("base64")}` : null;
      } catch {
        return null;
      }
    },

    async openProfileFolder(
      id: string,
      folder: "game" | "mods" | "resourcepacks" | "shaderpacks" = "game",
    ): Promise<void> {
      await requireProfile(id);
      const dirs = {
        game: paths.gameDir,
        mods: paths.modsDir,
        resourcepacks: paths.resourcePacksDir,
        shaderpacks: paths.shaderPacksDir,
      };
      await openFolder(dirs[folder](id));
    },

    /** The one folder every profile's screenshots go to. */
    async openScreenshotsFolder(): Promise<void> {
      await openFolder(paths.screenshotsDir);
    },

    // ---- Worlds ----

    /** A profile's worlds, with when each was last backed up. */
    async listWorlds(profileId: string): Promise<WorldInfo[]> {
      await requireProfile(profileId);
      return serialFs(() => deps.worldsWithBackups(profileId));
    },

    async moveWorld(worldId: string, toProfileId: string): Promise<void> {
      await requireProfile(toProfileId);
      await serialFs(async () => {
        const from = await readWorldOwner(paths, worldId);
        for (const p of [from, toProfileId]) if (p) assertNotRunning(p);
        await moveWorld(
          { paths, logger: log },
          worldId,
          toProfileId,
          await worldOptions(),
        );
      });
      changed();
    },

    async listOrphanWorlds(): Promise<OrphanWorld[]> {
      await whenReady();
      const { profileIds } = await worldOptions();
      return serialFs(() => listOrphans(paths, profileIds));
    },

    async openWorldFolder(profileId: string, worldId: string): Promise<void> {
      await requireProfile(profileId);
      const linked = (await listWorlds(paths, profileId)).find(
        (w) => w.id === worldId,
      );
      if (!linked) throw new AppError("WORLD_NOT_FOUND", "World not found.");
      await openFolder(
        linked.linked
          ? paths.worldDir(worldId)
          : paths.saveLink(profileId, worldId),
      );
    },
  };

  return { api };
}

export type ProfileService = ReturnType<typeof createProfileService>;
