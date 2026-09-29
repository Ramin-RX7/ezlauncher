import type {
  DisablePlan,
  ValidationFix,
  ValidationProblem,
} from "@shared/launcher";
import { acceptedLoaders, rangeText } from "../profiles/compat";
import type { ModDep } from "../profiles/modInfo";
import type {
  Issue,
  ValidationInput,
  ValidationMod,
  ValidationReport,
} from "./types";
import { parseFabricRange } from "./versions/fabricRange";
import { parseMavenRange } from "./versions/mavenRange";
import { parseSemVer, type SemVer } from "./versions/semver";

/*
 * Can a profile's enabled mods run? A pure function of what `collect.ts` gathered.
 * An error only ever comes from a clear, parsed rule; anything unsure is a warning.
 */

type Test = (v: SemVer) => boolean;

function rangeTest(
  range: string | readonly string[],
  format: "semver" | "maven",
): Test | undefined {
  if (format === "maven")
    return typeof range === "string" ? parseMavenRange(range) : undefined;
  return parseFabricRange(range);
}

const isAny = (range: string | readonly string[]): boolean =>
  typeof range === "string" ? range.trim() === "*" : range.includes("*");

/** Ids the loader itself provides, by loader. On Quilt, `fabricloader` is Quilt's own. */
const LOADER_IDS: Record<string, readonly string[]> = {
  fabric: ["fabricloader", "fabric-loader"],
  quilt: ["quilt_loader"],
};
const ALL_LOADER_IDS = new Set(Object.values(LOADER_IDS).flat());
/** Forge / NeoForge platform ids: not mods, and those loaders aren't supported here. */
const PLATFORM_IDS = new Set([
  "forge",
  "neoforge",
  "javafml",
  "fml",
  "lowcodefml",
  "mclanguage",
]);

const FABRIC_API_MODULE =
  /^(fabric|fabric-api|fabric-api-base|fabric-renderer-indigo|fabric-[a-z0-9-]+-v\d+)$/;
const QSL_MODULE = /^(qsl|quilted_fabric_api|quilt_(?!loader$)[a-z0-9_]+)$/;

/**
 * Well-known libraries that are split into many module ids: a missing module means
 * the whole library is missing, reported once, with its mod id as the search text.
 */
function knownLibrary(
  id: string,
  loaderId: string,
): { name: string; query: string } | undefined {
  if (
    loaderId === "quilt" &&
    (FABRIC_API_MODULE.test(id) || QSL_MODULE.test(id))
  )
    return { name: "QFAPI / QSL", query: "qsl" };
  if (FABRIC_API_MODULE.test(id))
    return { name: "Fabric API", query: "fabric-api" };
  return undefined;
}

interface Provider {
  sha1: string;
  name: string;
  version?: string;
}

/** Which enabled jar provides which mod id: its own id, `provides`, and bundled mods. */
function buildIndex(mods: readonly ValidationMod[]): Map<string, Provider[]> {
  const index = new Map<string, Provider[]>();
  const add = (id: string, provider: Provider) => {
    const list = index.get(id) ?? [];
    if (
      !list.some(
        (p) => p.sha1 === provider.sha1 && p.version === provider.version,
      )
    )
      list.push(provider);
    index.set(id, list);
  };
  for (const m of mods) {
    const self = {
      sha1: m.sha1,
      name: m.name,
      ...(m.version && { version: m.version }),
    };
    if (m.modId) add(m.modId, self);
    for (const id of m.provides ?? []) add(id, self);
    for (const n of m.nested ?? []) {
      const nested = {
        sha1: m.sha1,
        name: m.name,
        ...(n.version && { version: n.version }),
      };
      add(n.modId, nested);
      for (const id of n.provides ?? []) add(id, nested);
    }
  }
  return index;
}

/** A short list of versions for a message: `1.18, 1.18.1, 1.18.2` or `1.16 … 1.18.2`. */
function versionsText(versions: readonly string[]): string {
  return versions.length <= 3
    ? versions.join(", ")
    : `${versions[0] ?? ""} … ${versions.at(-1) ?? ""}`;
}

const EMPTY: ValidationReport = {
  issues: [],
  requiredBy: {},
  errorCount: 0,
  warningCount: 0,
};

export function validate(input: ValidationInput): ValidationReport {
  const loader = input.loader;
  if (!loader) return EMPTY; // Vanilla loads no mods
  const accepted = acceptedLoaders(loader.id);
  const loaded = input.mods.filter((m) =>
    m.loaders.some((l) => accepted.includes(l)),
  );
  const index = buildIndex(loaded);
  const requiredBy = new Map<string, Set<string>>();
  const issues: Issue[] = [];

  const add = (
    m: ValidationMod,
    severity: Issue["severity"],
    problem: ValidationProblem,
    fix?: ValidationFix,
  ) => {
    issues.push({ ...problem, severity, modSha1: m.sha1, ...(fix && { fix }) });
  };

  /** A version requirement (Java, loader build) against a known version. */
  const requireVersion = (
    m: ValidationMod,
    dep: ModDep,
    version: SemVer,
    problem: ValidationProblem,
  ) => {
    if (isAny(dep.range)) return;
    const test = rangeTest(dep.range, dep.format);
    if (!test)
      add(m, "warning", {
        code: "unknown",
        reason: "range",
        detail: `${dep.id} ${rangeText(dep.range)}`,
      });
    else if (!test(version)) add(m, "error", problem);
  };

  const checkSource = (m: ValidationMod, jarSaysMc: boolean) => {
    const source = m.source;
    if (!source) return;
    if (
      source.loaders?.length &&
      !source.loaders.some((l) => accepted.includes(l))
    )
      add(m, "warning", {
        code: "sourceLoader",
        sourceId: source.sourceId,
        loaders: [...source.loaders],
      });
    // Only when the jar doesn't rule it out already: the jar's answer comes first.
    if (
      jarSaysMc &&
      source.gameVersions?.length &&
      !source.gameVersions.includes(input.gameVersion)
    )
      add(m, "warning", {
        code: "sourceMcVersion",
        sourceId: source.sourceId,
        versions: versionsText(source.gameVersions),
        gameVersion: input.gameVersion,
      });
  };

  const checkMinecraft = (m: ValidationMod): boolean => {
    const range = m.mcVersionRange;
    if (range === undefined) return true;
    if (!input.mcVersion) {
      add(m, "warning", {
        code: "unknown",
        reason: "mcVersion",
        detail: input.gameVersion,
      });
      return false;
    }
    const test = rangeTest(range, m.rangeFormat ?? "semver");
    if (!test) {
      add(m, "warning", {
        code: "unknown",
        reason: "range",
        detail: `minecraft ${rangeText(range)}`,
      });
      return false;
    }
    if (test(input.mcVersion)) return true;
    add(m, "error", {
      code: "mcVersion",
      range: rangeText(range),
      gameVersion: input.gameVersion,
    });
    return false;
  };

  const checkDepends = (m: ValidationMod) => {
    const reported = new Set<string>();
    for (const dep of m.depends ?? []) {
      if (dep.id === "java") {
        if (input.javaMajor !== undefined)
          requireVersion(
            m,
            dep,
            { nums: [input.javaMajor] },
            {
              code: "java",
              range: rangeText(dep.range),
              java: input.javaMajor,
            },
          );
        continue;
      }
      if (ALL_LOADER_IDS.has(dep.id)) {
        const installed = loader.version && parseSemVer(loader.version);
        if (LOADER_IDS[loader.id]?.includes(dep.id) && installed)
          requireVersion(m, dep, installed, {
            code: "loaderVersion",
            loader: loader.id,
            range: rangeText(dep.range),
            installed: loader.version ?? "",
          });
        continue;
      }
      if (PLATFORM_IDS.has(dep.id)) continue;

      const all = index.get(dep.id) ?? [];
      if (all.some((p) => p.sha1 === m.sha1)) continue; // bundled in the mod itself
      if (all.length === 0) {
        const known = knownLibrary(dep.id, loader.id);
        const key = known?.name ?? dep.id;
        if (reported.has(key)) continue;
        reported.add(key);
        add(
          m,
          "error",
          known
            ? {
                code: "missingDep",
                depId: known.query,
                range: "*",
                name: known.name,
              }
            : {
                code: "missingDep",
                depId: dep.id,
                range: rangeText(dep.range),
              },
          { kind: "download", query: known?.query ?? dep.id },
        );
        continue;
      }
      for (const p of all) {
        const set = requiredBy.get(p.sha1) ?? new Set<string>();
        set.add(m.sha1);
        requiredBy.set(p.sha1, set);
      }
      if (isAny(dep.range)) continue;
      const test = rangeTest(dep.range, dep.format);
      if (!test) {
        add(m, "warning", {
          code: "unknown",
          reason: "range",
          detail: `${dep.id} ${rangeText(dep.range)}`,
        });
        continue;
      }
      const parsed = all.map((p) =>
        p.version ? parseSemVer(p.version) : undefined,
      );
      if (parsed.some((v) => v !== undefined && test(v))) continue;
      if (parsed.every((v) => v === undefined)) {
        add(m, "warning", {
          code: "unknown",
          reason: "version",
          detail: dep.id,
        });
        continue;
      }
      const first = all[0];
      add(m, "error", {
        code: "depVersion",
        depId: dep.id,
        range: rangeText(dep.range),
        found: first?.version ?? "?",
        otherName: first?.name ?? dep.id,
      });
    }
  };

  /** `breaks` (error) and `conflicts` (warning) against the other enabled mods. */
  const checkAgainst = (m: ValidationMod, kind: "breaks" | "conflicts") => {
    const seen = new Set<string>();
    for (const dep of m[kind] ?? []) {
      const others = (index.get(dep.id) ?? []).filter((p) => p.sha1 !== m.sha1);
      if (others.length === 0) continue;
      const test = isAny(dep.range)
        ? () => true
        : rangeTest(dep.range, dep.format);
      if (!test) {
        add(m, "warning", {
          code: "unknown",
          reason: "range",
          detail: `${dep.id} ${rangeText(dep.range)}`,
        });
        continue;
      }
      for (const p of others) {
        if (seen.has(p.sha1)) continue;
        const version = p.version ? parseSemVer(p.version) : undefined;
        // A version that can't be read only counts for "any version".
        const hit = version ? test(version) : isAny(dep.range);
        if (!hit) continue;
        seen.add(p.sha1);
        add(m, kind === "breaks" ? "error" : "warning", {
          code: kind,
          otherSha1: p.sha1,
          otherName: p.name,
        });
      }
    }
  };

  for (const m of input.mods) {
    const damage = input.damaged?.get(m.sha1);
    if (damage)
      add(
        m,
        "error",
        { code: "damaged", reason: damage },
        m.source ? { kind: "redownload" } : undefined,
      );
    if (m.loaders.length === 0) {
      add(m, "warning", { code: "unknown", reason: "noMetadata" });
      checkSource(m, true);
      continue;
    }
    if (!loaded.includes(m)) {
      add(m, "error", { code: "wrongLoader", loaders: [...m.loaders] });
      continue;
    }
    checkSource(m, checkMinecraft(m));
    checkDepends(m);
    checkAgainst(m, "breaks");
    checkAgainst(m, "conflicts");
  }

  // Two enabled jars with the same id (bundled copies are fine: the loader picks one).
  const byId = new Map<string, ValidationMod[]>();
  for (const m of loaded)
    if (m.modId) byId.set(m.modId, [...(byId.get(m.modId) ?? []), m]);
  for (const [modId, group] of byId) {
    if (group.length < 2) continue;
    for (const m of group) {
      const other = group.find((o) => o !== m);
      if (other)
        add(m, "error", {
          code: "duplicateId",
          modId,
          otherSha1: other.sha1,
          otherName: other.name,
        });
    }
  }

  return {
    issues,
    requiredBy: Object.fromEntries(
      [...requiredBy].map(([sha1, users]) => [sha1, [...users]]),
    ),
    errorCount: issues.filter((i) => i.severity === "error").length,
    warningCount: issues.filter((i) => i.severity === "warning").length,
  };
}

const without = (input: ValidationInput, off: ReadonlySet<string>) => ({
  ...input,
  mods: input.mods.filter((m) => !off.has(m.sha1)),
});

/**
 * "Disable problem mods": every mod with an error, then the mods that miss a required
 * mod because of that, until nothing changes.
 */
export function disableCascade(input: ValidationInput): DisablePlan {
  const names = new Map(input.mods.map((m) => [m.sha1, m.name]));
  const plan: DisablePlan["mods"] = [];
  const off = new Set<string>();
  for (const issue of validate(input).issues) {
    if (issue.severity !== "error" || off.has(issue.modSha1)) continue;
    off.add(issue.modSha1);
    plan.push({
      sha1: issue.modSha1,
      name: names.get(issue.modSha1) ?? issue.modSha1,
      reason: "error",
    });
  }
  for (;;) {
    const newly = validate(without(input, off)).issues.filter(
      (i) =>
        i.severity === "error" &&
        (i.code === "missingDep" || i.code === "depVersion") &&
        !off.has(i.modSha1),
    );
    if (newly.length === 0) return { mods: plan };
    for (const i of newly) {
      if (off.has(i.modSha1)) continue;
      off.add(i.modSha1);
      plan.push({
        sha1: i.modSha1,
        name: names.get(i.modSha1) ?? i.modSha1,
        reason: "dependency",
      });
    }
  }
}

/**
 * Disabling `sha1`: the enabled mods it needed (directly or through others) that no
 * remaining mod needs any more. They go with it.
 */
export function orphanedDependencies(
  input: ValidationInput,
  sha1: string,
): string[] {
  const before = validate(input).requiredBy;
  const off = new Set([sha1]);
  const orphans: string[] = [];
  for (;;) {
    const rest = without(input, off);
    const after = validate(rest).requiredBy;
    const newly = rest.mods.filter(
      (m) =>
        (before[m.sha1] ?? []).some((user) => off.has(user)) &&
        (after[m.sha1] ?? []).length === 0,
    );
    if (newly.length === 0) return orphans;
    for (const m of newly) {
      off.add(m.sha1);
      orphans.push(m.sha1);
    }
  }
}
