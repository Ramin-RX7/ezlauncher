import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { parse as parseToml } from "smol-toml";

/*
 * Read a mod's own metadata from its jar: `fabric.mod.json` (Fabric), `quilt.mod.json`
 * (Quilt), `META-INF/mods.toml` / `META-INF/neoforge.mods.toml` (Forge / NeoForge).
 * A jar with none of these is still a mod, just an unknown one.
 * Mods bundled inside the jar (Fabric/Quilt `jars`, Forge `META-INF/jarjar/`) are read
 * too: the loader counts them as present.
 */

/** A dependency or conflict on another mod id, with the versions it applies to. */
export interface ModDep {
  id: string;
  range: string | string[];
  /** Fabric/Quilt predicates or Maven ranges. */
  format: "semver" | "maven";
}

/** A mod bundled inside another jar. */
export interface NestedMod {
  modId: string;
  version?: string;
  provides?: string[];
}

export interface ModInfo {
  modId?: string;
  name: string;
  version?: string;
  /** `fabric`, `quilt`, `forge`, `neoforge`; empty = unknown. */
  loaders: string[];
  /** The declared Minecraft versions, as written. */
  mcVersionRange?: string | string[];
  /** How `mcVersionRange` is written: Fabric/Quilt predicates or Maven ranges. */
  rangeFormat?: "semver" | "maven";
  /** Required mods (other than `minecraft`, which is `mcVersionRange`). */
  depends?: ModDep[];
  /** Mods it can't run with (Fabric/Quilt `breaks`, Forge `incompatible`). */
  breaks?: ModDep[];
  /** Mods that may cause problems with it (Fabric `conflicts`). */
  conflicts?: ModDep[];
  /** Extra mod ids this jar counts as. */
  provides?: string[];
  /** Mods bundled inside, at any depth. */
  nested?: NestedMod[];
  /** PNG bytes. */
  icon?: Uint8Array;
}

const FABRIC = "fabric.mod.json";
const QUILT = "quilt.mod.json";
const FORGE = "META-INF/mods.toml";
const NEOFORGE = "META-INF/neoforge.mods.toml";
const MANIFEST = "META-INF/MANIFEST.MF";
const METADATA = new Set([FABRIC, QUILT, FORGE, NEOFORGE, MANIFEST]);
const JARJAR = /^META-INF\/jarjar\/[^/]+\.jar$/i;
const MAX_JAR = 512 * 1024 * 1024;
const MAX_ICON = 1024 * 1024;
const MAX_DEPTH = 4;
const MAX_NESTED = 256;
/** A range that can't be read (e.g. Quilt's `{ any: … }` objects): checks give "unknown". */
export const UNREADABLE_RANGE = "<unreadable>";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
const strings = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? v : undefined;
const unique = <T>(list: T[]): T[] => [...new Set(list)];

/** Some mods put raw line breaks or tabs inside JSON strings; Fabric accepts them. */
function parseLenientJson(text: string): unknown {
  const clean = text.replace(/^\uFEFF/, "");
  try {
    return JSON.parse(clean);
  } catch {
    return JSON.parse(clean.replace(/[\r\n\t]/g, " "));
  }
}

function rangeOf(v: unknown): string | string[] | undefined {
  return str(v) ?? strings(v);
}

/** `icon` as a path, or a size map where the largest size up to 128 wins. */
function fabricIcon(icon: unknown): string | undefined {
  if (typeof icon === "string") return icon;
  if (!isObject(icon)) return undefined;
  const sizes = Object.entries(icon)
    .filter((e): e is [string, string] => typeof e[1] === "string")
    .map(([size, path]) => [Number(size), path] as const)
    .filter(([size]) => Number.isFinite(size))
    .sort((a, b) => a[0] - b[0]);
  const fitting = sizes.filter(([size]) => size <= 128);
  return (fitting.at(-1) ?? sizes[0])?.[1];
}

interface Parsed extends Omit<ModInfo, "icon" | "nested"> {
  iconPath?: string;
  /** Paths of bundled jars inside this jar. */
  jarPaths: string[];
}

/** Only set lists that have content, so stored metadata stays small. */
function lists(
  entries: Partial<Record<"depends" | "breaks" | "conflicts", ModDep[]>> & {
    provides?: string[];
  },
): Pick<ModInfo, "depends" | "breaks" | "conflicts" | "provides"> {
  const out: Pick<ModInfo, "depends" | "breaks" | "conflicts" | "provides"> =
    {};
  if (entries.depends?.length) out.depends = entries.depends;
  if (entries.breaks?.length) out.breaks = entries.breaks;
  if (entries.conflicts?.length) out.conflicts = entries.conflicts;
  if (entries.provides?.length) out.provides = entries.provides;
  return out;
}

/** Fabric's `{ "modid": "range" | ["range", …] }` maps. */
function fabricDeps(v: unknown, skip: readonly string[] = []): ModDep[] {
  if (!isObject(v)) return [];
  return Object.entries(v)
    .filter(([id]) => !skip.includes(id))
    .map(([id, range]) => ({
      id,
      range: rangeOf(range) ?? (range === "" ? "*" : UNREADABLE_RANGE),
      format: "semver" as const,
    }));
}

function parseFabric(text: string): Parsed | undefined {
  const json = parseLenientJson(text);
  if (!isObject(json)) return undefined;
  const depends = isObject(json.depends) ? json.depends : {};
  const range = rangeOf(depends.minecraft);
  const iconPath = fabricIcon(json.icon);
  const modId = str(json.id);
  const jarPaths = (Array.isArray(json.jars) ? json.jars : [])
    .map((j) => (isObject(j) ? str(j.file) : undefined))
    .filter((p): p is string => p !== undefined);
  return {
    ...(modId && { modId }),
    name: str(json.name) ?? modId ?? "",
    ...(str(json.version) && { version: str(json.version) }),
    loaders: ["fabric"],
    ...(range && { mcVersionRange: range, rangeFormat: "semver" as const }),
    ...lists({
      depends: fabricDeps(json.depends, ["minecraft"]),
      breaks: fabricDeps(json.breaks),
      conflicts: fabricDeps(json.conflicts),
      provides: strings(json.provides) ?? [],
    }),
    ...(iconPath && { iconPath }),
    jarPaths,
  };
}

/** Quilt's dependency lists: `"id"` or `{ id, versions, optional }`. */
function quiltDeps(v: unknown, skip: readonly string[] = []): ModDep[] {
  if (!Array.isArray(v)) return [];
  const deps: ModDep[] = [];
  for (const d of v) {
    if (typeof d === "string") {
      if (!skip.includes(d)) deps.push({ id: d, range: "*", format: "semver" });
      continue;
    }
    // An array means "any of these"; it can't be checked simply, so it's left out.
    if (!isObject(d) || d.optional === true) continue;
    const id = str(d.id);
    if (!id || skip.includes(id)) continue;
    const range =
      d.versions === undefined
        ? "*"
        : (rangeOf(d.versions) ?? UNREADABLE_RANGE);
    deps.push({ id, range, format: "semver" });
  }
  return deps;
}

function parseQuilt(text: string): Parsed | undefined {
  const json = parseLenientJson(text);
  const loader = isObject(json) ? json.quilt_loader : undefined;
  if (!isObject(loader)) return undefined;
  const metadata = isObject(loader.metadata) ? loader.metadata : {};
  const depends = Array.isArray(loader.depends) ? loader.depends : [];
  const minecraft = depends.find(
    (d): d is Json => isObject(d) && d.id === "minecraft",
  );
  const range = minecraft ? rangeOf(minecraft.versions) : undefined;
  const iconPath = fabricIcon(metadata.icon);
  const modId = str(loader.id);
  const provides = (Array.isArray(loader.provides) ? loader.provides : [])
    .map((p) =>
      typeof p === "string" ? str(p) : isObject(p) ? str(p.id) : undefined,
    )
    .filter((p): p is string => p !== undefined);
  return {
    ...(modId && { modId }),
    name: str(metadata.name) ?? modId ?? "",
    ...(str(loader.version) && { version: str(loader.version) }),
    loaders: ["quilt"],
    ...(range && { mcVersionRange: range, rangeFormat: "semver" as const }),
    ...lists({
      depends: quiltDeps(loader.depends, ["minecraft"]),
      breaks: quiltDeps(loader.breaks),
      provides,
    }),
    ...(iconPath && { iconPath }),
    jarPaths: strings(loader.jars) ?? [],
  };
}

function manifestVersion(manifest: string | undefined): string | undefined {
  const match = manifest && /^Implementation-Version:\s*(.+)$/m.exec(manifest);
  return match ? match[1]?.trim() : undefined;
}

function parseForge(
  text: string,
  neoforgeFile: boolean,
  manifest: string | undefined,
): Parsed | undefined {
  const toml = parseToml(text) as Json;
  const mods = (Array.isArray(toml.mods) ? toml.mods : []).filter(isObject);
  const mod = mods[0];
  if (!mod) return undefined;
  const modId = str(mod.modId);
  const deps = isObject(toml.dependencies) ? toml.dependencies : {};
  const own =
    modId && Array.isArray(deps[modId])
      ? (deps[modId] as unknown[]).filter(isObject)
      : [];
  const depIds = own.map((d) => d.modId);
  const minecraft = own.find((d) => d.modId === "minecraft");
  const range = minecraft ? str(minecraft.versionRange) : undefined;
  // Old NeoForge (1.20.x) used mods.toml too; it depends on "neoforge" instead of "forge".
  const neoforge =
    neoforgeFile || (depIds.includes("neoforge") && !depIds.includes("forge"));
  let version = str(mod.version);
  if (version?.includes("${file.jarVersion}"))
    version = manifestVersion(manifest);
  const iconPath = str(mod.logoFile) ?? str(toml.logoFile);

  // Every mod in the file counts; their required and incompatible mods are the jar's.
  const depends: ModDep[] = [];
  const breaks: ModDep[] = [];
  for (const list of Object.values(deps)) {
    if (!Array.isArray(list)) continue;
    for (const d of list.filter(isObject)) {
      const id = str(d.modId);
      if (!id || id === "minecraft") continue;
      const type = str(d.type)?.toLowerCase();
      const dep: ModDep = {
        id,
        range: str(d.versionRange) ?? "*",
        format: "maven",
      };
      if (type === "incompatible") breaks.push(dep);
      else if (
        type === "required" ||
        (type === undefined && d.mandatory === true)
      )
        depends.push(dep);
    }
  }
  const provides = mods
    .slice(1)
    .map((m) => str(m.modId))
    .filter((id): id is string => id !== undefined);
  return {
    ...(modId && { modId }),
    name: str(mod.displayName) ?? modId ?? "",
    ...(version && { version }),
    loaders: [neoforge ? "neoforge" : "forge"],
    ...(range && { mcVersionRange: range, rangeFormat: "maven" as const }),
    ...lists({ depends, breaks, provides }),
    ...(iconPath && { iconPath }),
    jarPaths: [],
  };
}

/** Every metadata file in the jar, parsed. A broken one just doesn't count. */
function parseMetadata(files: Record<string, Uint8Array>): Parsed[] {
  const text = (name: string) => {
    const bytes = files[name];
    return bytes ? strFromU8(bytes) : undefined;
  };
  const found: Parsed[] = [];
  const add = (
    content: string | undefined,
    parse: (t: string) => Parsed | undefined,
  ) => {
    if (content === undefined) return;
    try {
      const parsed = parse(content);
      if (parsed) found.push(parsed);
    } catch {
      // unreadable
    }
  };
  add(text(FABRIC), parseFabric);
  add(text(QUILT), parseQuilt);
  add(text(NEOFORGE), (t) => parseForge(t, true, text(MANIFEST)));
  add(text(FORGE), (t) => parseForge(t, false, text(MANIFEST)));
  return found;
}

/** The bundled jars' bytes: the paths the metadata lists, plus Forge's `jarjar/`. */
function nestedJars(jar: Uint8Array, found: readonly Parsed[]): Uint8Array[] {
  const listed = new Set(
    found.flatMap((f) => f.jarPaths.map((p) => p.replace(/^\/+/, ""))),
  );
  try {
    return Object.values(
      unzipSync(jar, {
        filter: (f) => listed.has(f.name) || JARJAR.test(f.name),
      }),
    );
  } catch {
    return [];
  }
}

/** Bundled mods, depth first and flattened, within the depth and count limits. */
function collectNested(
  jars: readonly Uint8Array[],
  depth: number,
  out: NestedMod[],
): void {
  if (depth > MAX_DEPTH) return;
  for (const jar of jars) {
    if (out.length >= MAX_NESTED) return;
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(jar, { filter: (f) => METADATA.has(f.name) });
    } catch {
      continue;
    }
    const found = parseMetadata(files);
    for (const f of found) {
      if (!f.modId || out.length >= MAX_NESTED) continue;
      out.push({
        modId: f.modId,
        ...(f.version && { version: f.version }),
        ...(f.provides && { provides: f.provides }),
      });
    }
    if (found.length > 0) collectNested(nestedJars(jar, found), depth + 1, out);
  }
}

/** Mod info from the bytes of a jar. Never throws: unreadable parts are skipped. */
export function readModInfoFromJar(jar: Uint8Array, fileName: string): ModInfo {
  const unknown: ModInfo = {
    name: fileName.replace(/\.jar$/i, ""),
    loaders: [],
  };
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(jar, { filter: (f) => METADATA.has(f.name) });
  } catch {
    return unknown; // not a zip, or damaged
  }
  const found = parseMetadata(files);
  const main = found[0];
  if (!main) return unknown;

  // A jar made for several loaders counts for each; the first metadata names it.
  const info: ModInfo = {
    ...(main.modId && { modId: main.modId }),
    name: main.name || unknown.name,
    ...(main.version && { version: main.version }),
    loaders: unique(found.flatMap((f) => f.loaders)),
    ...(main.mcVersionRange && {
      mcVersionRange: main.mcVersionRange,
      ...(main.rangeFormat && { rangeFormat: main.rangeFormat }),
    }),
    ...lists({
      ...(main.depends && { depends: main.depends }),
      ...(main.breaks && { breaks: main.breaks }),
      ...(main.conflicts && { conflicts: main.conflicts }),
      provides: unique([
        ...found.flatMap((f) => f.provides ?? []),
        // The other loaders' metadata may name the mod differently.
        ...found
          .map((f) => f.modId)
          .filter((id): id is string => id !== undefined && id !== main.modId),
      ]),
    }),
  };
  const nested: NestedMod[] = [];
  collectNested(nestedJars(jar, found), 1, nested);
  if (nested.length > 0) info.nested = nested;

  const iconPath = found.find((f) => f.iconPath)?.iconPath?.replace(/^\/+/, "");
  if (iconPath) {
    try {
      const icon = unzipSync(jar, { filter: (f) => f.name === iconPath })[
        iconPath
      ];
      const isPng =
        icon?.[0] === 0x89 &&
        icon[1] === 0x50 &&
        icon[2] === 0x4e &&
        icon[3] === 0x47;
      if (icon && isPng && icon.length <= MAX_ICON) info.icon = icon;
    } catch {
      // no icon
    }
  }
  return info;
}

/** Mod info from a jar file on disk. */
export async function readModInfo(path: string): Promise<ModInfo> {
  const fileName = basename(path);
  try {
    if ((await stat(path)).size > MAX_JAR)
      return { name: fileName.replace(/\.jar$/i, ""), loaders: [] };
    return readModInfoFromJar(new Uint8Array(await readFile(path)), fileName);
  } catch {
    return { name: fileName.replace(/\.jar$/i, ""), loaders: [] };
  }
}
