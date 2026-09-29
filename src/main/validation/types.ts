import type { ModDep, NestedMod } from "../profiles/modInfo";
import type { SemVer } from "./versions/semver";

/** `Issue { severity, modSha1, code, …params, fix? }`: shared with the renderer, which words it. */
export type {
  ValidationIssue as Issue,
  ValidationReport,
} from "@shared/launcher";

/** An enabled mod, as the checks see it: the jar's metadata plus what its source says. */
export interface ValidationMod {
  sha1: string;
  name: string;
  modId?: string;
  version?: string;
  loaders: readonly string[];
  mcVersionRange?: string | readonly string[];
  rangeFormat?: "semver" | "maven";
  depends?: readonly ModDep[];
  breaks?: readonly ModDep[];
  conflicts?: readonly ModDep[];
  provides?: readonly string[];
  nested?: readonly NestedMod[];
  /** From the mod site (e.g. Modrinth); only fills in what the jar doesn't say. */
  source?: {
    sourceId: string;
    loaders?: readonly string[];
    gameVersions?: readonly string[];
  };
}

export type DamageReason = "missing" | "size" | "unreadable" | "sha1";

/** Everything the checks need, gathered by `collect.ts`. No file or network access after this. */
export interface ValidationInput {
  gameVersion: string;
  /** `gameVersion` mapped to a comparable version; undefined = it can't be mapped. */
  mcVersion?: SemVer;
  /** null = Vanilla. `version` is the installed build; missing = not installed yet. */
  loader: { id: string; version?: string } | null;
  /** The Java major version the profile runs on; missing = not known yet (not installed). */
  javaMajor?: number;
  mods: readonly ValidationMod[];
  /** Damaged files, from `integrity.ts`. */
  damaged?: ReadonlyMap<string, DamageReason>;
}
