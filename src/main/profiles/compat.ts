import type { ModCompat, Profile } from "@shared/launcher";
import { matchesFabricRange } from "../validation/versions/fabricRange";
import { matchesMavenRange } from "../validation/versions/mavenRange";
import { parseMcVersion } from "../validation/versions/mcVersion";

export interface CompatInput {
  loaders: readonly string[];
  mcVersionRange?: string | readonly string[];
  rangeFormat?: "semver" | "maven";
}

/** The mod loaders a profile runs mods for. Quilt also loads Fabric mods. */
export function acceptedLoaders(loaderId: string | undefined): string[] {
  if (!loaderId) return [];
  return loaderId === "quilt" ? ["quilt", "fabric"] : [loaderId];
}

export function rangeText(range: string | readonly string[]): string {
  return typeof range === "string" ? range : range.join(" or ");
}

/**
 * Can this library mod be used in this profile? From the jar's own metadata:
 * the loader must match and the Minecraft version must be in the mod's range.
 * Anything that can't be read is "unknown", never "incompatible".
 */
export function checkCompat(
  mod: CompatInput,
  profile: Pick<Profile, "gameVersion" | "loader">,
): ModCompat {
  const accepted = acceptedLoaders(profile.loader?.id);
  if (accepted.length === 0)
    return { status: "incompatible", reason: { code: "vanilla" } };
  if (mod.loaders.length === 0) return { status: "unknown" };
  if (!mod.loaders.some((l) => accepted.includes(l))) {
    return {
      status: "incompatible",
      reason: { code: "loader", loaders: [...mod.loaders] },
    };
  }

  const range = mod.mcVersionRange;
  if (range === undefined) return { status: "compatible" }; // the mod names no version
  const version = parseMcVersion(profile.gameVersion);
  if (!version) return { status: "unknown" };
  const matches =
    mod.rangeFormat === "maven"
      ? typeof range === "string"
        ? matchesMavenRange(range, version)
        : undefined
      : matchesFabricRange(range, version);
  if (matches === undefined) return { status: "unknown" };
  return matches
    ? { status: "compatible" }
    : {
        status: "incompatible",
        reason: { code: "mcVersion", range: rangeText(range) },
      };
}
