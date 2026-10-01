import { copyFile, cp, readdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type {
  PackRef,
  Profile,
  ProfileShader,
  ProfileShaders,
} from "@shared/launcher";
import { AppError } from "../../core/errors";
import { writeFileAtomic } from "../../core/fsAtomic";
import type { Logger } from "../../core/logger";
import type { Paths } from "../../minecraft/paths";
import {
  newIrisConfig,
  readIrisSelection,
  writeIrisSelection,
  type IrisChanges,
} from "../irisConfig";
import { exists, type ReconcileDiff } from "../linkedStore";
import type { PackLibrary, PackMetaRecord } from "./library";
import type { PackRead } from "./packMeta";
import { readShaderFolder, readShaderZip } from "./shaderMeta";

/*
 * A profile's shader packs. Shaders run through the Iris mod, so they need Fabric
 * or Quilt. Every shader in the profile's `shaderpacks/` shows in Iris's in-game
 * list; the active one lives only in Iris's `config/iris.properties` (see
 * irisConfig.ts). Each shader's own options are `shaderpacks/<entry>.txt`, which
 * Iris writes; they stay with the profile and follow the shader when it's renamed.
 * Iris doesn't keep shader zips open, but its config is rewritten when the game
 * starts, so the caller makes sure no game of the profile runs while anything
 * here writes.
 */

type ProfileLike = Pick<Profile, "id" | "loader">;

/** A shader the renderer sends (checked before use). */
export const shaderRefSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("library"),
    sha1: z.string().regex(/^[0-9a-f]{40}$/),
  }),
  z.object({ kind: z.literal("folder"), name: z.string().min(1).max(255) }),
]);

const EOL = process.platform === "win32" ? "\r\n" : "\n";

export function createProfileShaders({
  paths,
  library,
  logger,
}: {
  paths: Paths;
  /** The shader pack library (`shaderPackKind`). */
  library: PackLibrary;
  logger?: Logger;
}) {
  async function readConfig(profileId: string): Promise<string | undefined> {
    try {
      return await readFile(paths.irisConfigFile(profileId), "latin1");
    } catch {
      return undefined;
    }
  }

  /** Write Iris's config, keeping a copy of the file from before the first change. */
  async function saveConfig(
    profileId: string,
    changes: IrisChanges,
  ): Promise<void> {
    const path = paths.irisConfigFile(profileId);
    const text = await readConfig(profileId);
    try {
      if (
        text !== undefined &&
        !(await exists(paths.irisConfigBackup(profileId)))
      )
        await copyFile(path, paths.irisConfigBackup(profileId));
      const next =
        text === undefined
          ? newIrisConfig(changes, EOL)
          : writeIrisSelection(text, changes);
      await writeFileAtomic(path, Buffer.from(next, "latin1"));
    } catch (err) {
      throw new AppError(
        "IRIS_CONFIG_UNWRITABLE",
        "Couldn't save Iris's settings.",
        { cause: err },
      );
    }
  }

  /** Unzipped shader folders in the profile's `shaderpacks/`. */
  async function folders(
    profileId: string,
  ): Promise<{ name: string; read: PackRead }[]> {
    let entries;
    try {
      entries = await readdir(paths.shaderPacksDir(profileId), {
        withFileTypes: true,
      });
    } catch {
      return [];
    }
    const found = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      found.push({
        name: entry.name,
        read: await readShaderFolder(
          join(paths.shaderPacksDir(profileId), entry.name),
        ),
      });
    }
    return found;
  }

  function libraryShader(sha1: string, meta: PackMetaRecord): ProfileShader {
    return {
      ref: { kind: "library", sha1 },
      name: meta.fileName.replace(/\.zip$/i, ""),
      hasIcon: meta.iconPath !== undefined,
      ...(meta.loaders && { irisTagged: meta.loaders.includes("iris") }),
      ...(meta.source && {
        source: {
          sourceId: meta.source.sourceId,
          projectId: meta.source.projectId,
          pageUrl: meta.source.pageUrl,
        },
      }),
    };
  }

  const folderShader = (name: string): ProfileShader => ({
    ref: { kind: "folder", name },
    name,
    hasIcon: false,
  });

  /** Move a shader's options file along with it (never over an existing one). */
  async function moveOptions(profileId: string, from: string, to: string) {
    const source = paths.shaderOptionsFile(profileId, from);
    const target = paths.shaderOptionsFile(profileId, to);
    if (!(await exists(source)) || (await exists(target))) return;
    try {
      await rename(source, target);
    } catch (err) {
      logger?.warn(`moving the options of ${from} failed`, err);
    }
  }

  return {
    /** The profile's Shaders tab. */
    async view(
      profile: ProfileLike,
      { running, hasIris }: { running: boolean; hasIris: boolean },
    ): Promise<ProfileShaders> {
      const { packs, links } = await library.snapshot(profile.id);
      const found = await folders(profile.id);
      const okFolders = found.filter((f) => f.read.status === "ok");
      const text = await readConfig(profile.id);
      const selection = text ? readIrisSelection(text) : undefined;

      let active: PackRef | undefined;
      const entry = selection?.enabled ? selection.shaderPack : null;
      if (entry) {
        const sha1 = links[entry];
        if (sha1 && packs[sha1]) active = { kind: "library", sha1 };
        else if (okFolders.some((f) => f.name === entry))
          active = { kind: "folder", name: entry };
      }

      const linked = new Set(Object.values(links));
      const byName = (a: ProfileShader, b: ProfileShader) =>
        a.name.localeCompare(b.name);
      const inProfile = [
        ...[...linked].flatMap((sha1) => {
          const meta = packs[sha1];
          return meta ? [libraryShader(sha1, meta)] : [];
        }),
        ...okFolders.map((f) => folderShader(f.name)),
      ].sort(byName);
      const available = Object.entries(packs)
        .filter(([sha1]) => !linked.has(sha1))
        .map(([sha1, meta]) => libraryShader(sha1, meta))
        .sort(byName);

      const notPacks: ProfileShaders["notPacks"] = [];
      for (const f of found)
        if (f.read.status === "nested")
          notPacks.push({
            name: f.name,
            reason: "nested",
            folder: f.read.folder,
          });
      let zips: string[] = [];
      try {
        zips = (await readdir(paths.shaderPacksDir(profile.id))).filter(
          (n) => /\.zip$/i.test(n) && links[n] === undefined,
        );
      } catch {
        // no folder yet
      }
      for (const name of zips) {
        const read = await readShaderZip(
          join(paths.shaderPacksDir(profile.id), name),
        );
        if (read.status === "ok") continue; // adopted on the next sync
        notPacks.push({
          name,
          reason: read.status === "nested" ? "invalid" : read.status,
        });
      }

      const noLoader = profile.loader === null;
      const locked: ProfileShaders["locked"] = noLoader
        ? "noLoader"
        : running
          ? "running"
          : undefined;
      return {
        ...(active && { active }),
        inProfile,
        available,
        notPacks,
        iris: noLoader ? "noLoader" : hasIris ? "present" : "missing",
        ...(locked && { locked }),
      };
    },

    /**
     * Make a shader the profile's active one (adding a library shader to the
     * profile first), or turn shaders off with `null`. Turning off keeps the
     * pack's name, so Iris's own on/off switch brings it back.
     */
    async setActive(profile: ProfileLike, ref: PackRef | null): Promise<void> {
      if (profile.loader === null)
        throw new AppError(
          "SHADERS_NEED_LOADER",
          "Shaders need Fabric or Quilt.",
        );
      if (ref === null) {
        await saveConfig(profile.id, { enabled: false });
        return;
      }
      let entry: string;
      if (ref.kind === "library") {
        entry = await library.link(profile.id, ref.sha1);
      } else {
        const read = await readShaderFolder(
          paths.folderShaderDir(profile.id, ref.name),
        );
        if (read.status !== "ok")
          throw new AppError(
            "SHADER_NOT_FOUND",
            `${ref.name} isn't a shader folder.`,
          );
        entry = ref.name;
      }
      await saveConfig(profile.id, { shaderPack: entry, enabled: true });
    },

    /** Put a library shader in the profile (Iris lists it in game). */
    async add(profile: ProfileLike, sha1: string): Promise<void> {
      await library.link(profile.id, sha1);
    },

    /**
     * Take a library shader out of the profile; it stays in the library, and its
     * options file stays too (so adding it again brings them back). Removing the
     * active shader turns shaders off.
     */
    async remove(profile: ProfileLike, sha1: string): Promise<void> {
      const { links } = await library.snapshot(profile.id);
      const names = Object.entries(links)
        .filter(([, s]) => s === sha1)
        .map(([name]) => name);
      const text = await readConfig(profile.id);
      const current = text ? readIrisSelection(text).shaderPack : null;
      if (current !== null && names.includes(current))
        await saveConfig(profile.id, { shaderPack: null });
      await library.unlink(profile.id, sha1);
    },

    /** After a sync: follow files renamed by hand (and their options), forget removed ones. */
    async followSync(profile: ProfileLike, diff: ReconcileDiff): Promise<void> {
      if (diff.renamed.length === 0 && diff.removed.length === 0) return;
      for (const r of diff.renamed) await moveOptions(profile.id, r.from, r.to);
      const text = await readConfig(profile.id);
      if (text === undefined) return;
      const current = readIrisSelection(text).shaderPack;
      if (current === null) return;
      const renamed = diff.renamed.find((r) => r.from === current);
      if (renamed) {
        await saveConfig(profile.id, { shaderPack: renamed.to });
        logger?.info(`followed the renamed shader in ${profile.id}`);
      } else if (diff.removed.includes(current)) {
        await saveConfig(profile.id, { shaderPack: null });
      }
    },

    /**
     * A duplicated profile gets the same shaders, each with its options file, and
     * the same active shader. `to` must be new, with no shaders yet.
     */
    async copyTo(from: ProfileLike, to: ProfileLike): Promise<void> {
      const { links } = await library.snapshot(from.id);
      const mapped = new Map<string, string>();
      for (const [name, sha1] of Object.entries(links)) {
        if (!(await exists(join(paths.shaderPacksDir(from.id), name))))
          continue;
        mapped.set(name, await library.link(to.id, sha1));
      }
      for (const f of await folders(from.id)) {
        if (f.read.status !== "ok") continue;
        await cp(
          paths.folderShaderDir(from.id, f.name),
          paths.folderShaderDir(to.id, f.name),
          { recursive: true, errorOnExist: false },
        );
        mapped.set(f.name, f.name);
      }
      for (const [name, newName] of mapped) {
        const options = paths.shaderOptionsFile(from.id, name);
        if (await exists(options))
          await copyFile(options, paths.shaderOptionsFile(to.id, newName));
      }
      const text = await readConfig(from.id);
      if (text === undefined) return;
      const selection = readIrisSelection(text);
      const pack =
        selection.shaderPack === null
          ? undefined
          : mapped.get(selection.shaderPack);
      if (pack === undefined) return;
      await saveConfig(to.id, { shaderPack: pack, enabled: selection.enabled });
    },
  };
}

export type ProfileShadersApi = ReturnType<typeof createProfileShaders>;
