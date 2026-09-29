import type { Profile } from "@shared/launcher";
import { readInstallMarker } from "../minecraft/installer";
import type { Paths } from "../minecraft/paths";
import { diskVersionLoader, resolveVersion } from "../minecraft/versionJson";
import type { ModLibrary } from "../profiles/mods";
import type { IntegrityFile } from "./integrity";
import type { ValidationInput, ValidationMod } from "./types";
import { parseMcVersion, type McVersionEntry } from "./versions/mcVersion";

/** Old versions have no `javaVersion`; they run on Java 8. */
const DEFAULT_JAVA_MAJOR = 8;

export interface CollectDeps {
  paths: Paths;
  library: Pick<ModLibrary, "enabledMods">;
  /** The versions in Mojang's manifest (the saved copy), to place snapshots; undefined = none. */
  versions: () => Promise<readonly McVersionEntry[] | undefined>;
}

export type CollectProfile = Pick<
  Profile,
  "id" | "gameVersion" | "loader" | "installedVersionId"
>;

/**
 * Everything the checks need for a profile: its enabled mods (with their nested mods
 * and source data), the installed loader build and Java version, and the files to
 * check for damage. Loader build and Java are only known once the profile is installed.
 */
export async function collectInput(
  { paths, library, versions }: CollectDeps,
  profile: CollectProfile,
): Promise<{ input: ValidationInput; files: IntegrityFile[] }> {
  const enabled = await library.enabledMods(profile.id);
  const mods = enabled.map(({ sha1, meta }): ValidationMod => ({
    sha1,
    name: meta.name,
    ...(meta.modId && { modId: meta.modId }),
    ...(meta.version && { version: meta.version }),
    loaders: meta.loaders,
    ...(meta.mcVersionRange && { mcVersionRange: meta.mcVersionRange }),
    ...(meta.rangeFormat && { rangeFormat: meta.rangeFormat }),
    ...(meta.depends && { depends: meta.depends }),
    ...(meta.breaks && { breaks: meta.breaks }),
    ...(meta.conflicts && { conflicts: meta.conflicts }),
    ...(meta.provides && { provides: meta.provides }),
    ...(meta.nested && { nested: meta.nested }),
    ...(meta.source && {
      source: {
        sourceId: meta.source.sourceId,
        ...(meta.source.loaders && { loaders: meta.source.loaders }),
        ...(meta.source.gameVersions && {
          gameVersions: meta.source.gameVersions,
        }),
      },
    }),
  }));
  const files = enabled.map(({ sha1, meta, copies }): IntegrityFile => ({
    sha1,
    path: paths.modStoreFile(sha1),
    ...(meta.size !== undefined && { size: meta.size }),
    ...(meta.verified && { verified: meta.verified }),
    ...(copies.length > 0 && { copies }),
  }));

  let loaderVersion: string | undefined;
  let javaMajor: number | undefined;
  const installed = profile.installedVersionId;
  if (installed) {
    const marker = await readInstallMarker(paths, installed);
    if (
      marker?.loader &&
      marker.loader.id === profile.loader?.id &&
      marker.loader.gameVersion === profile.gameVersion
    )
      loaderVersion = marker.loader.loaderVersion;
    if (marker) {
      try {
        const version = await resolveVersion(
          installed,
          diskVersionLoader(paths),
        );
        javaMajor = version.javaVersion?.majorVersion ?? DEFAULT_JAVA_MAJOR;
      } catch {
        // unreadable version files: Java stays unknown
      }
    }
  }

  const known = await versions().catch(() => undefined);
  const mcVersion = parseMcVersion(profile.gameVersion, known);
  return {
    input: {
      gameVersion: profile.gameVersion,
      ...(mcVersion && { mcVersion }),
      loader: profile.loader
        ? {
            id: profile.loader.id,
            ...(loaderVersion && { version: loaderVersion }),
          }
        : null,
      ...(javaMajor !== undefined && { javaMajor }),
      mods,
    },
    files,
  };
}
