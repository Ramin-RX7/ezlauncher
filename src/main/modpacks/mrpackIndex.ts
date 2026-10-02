import { z } from "zod";
import { AppError } from "../core/errors";
import { safeJoin } from "../minecraft/paths";

/*
 * `modrinth.index.json`, the heart of a Modrinth mod pack (`.mrpack`): which files
 * to download where, and which Minecraft version and loader the pack runs on.
 * Format: https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack
 */

export const INDEX_NAME = "modrinth.index.json";

/** Hosts a pack may download from (the format allows only these). */
export const ALLOWED_HOSTS = new Set([
  "cdn.modrinth.com",
  "github.com",
  "raw.githubusercontent.com",
  "gitlab.com",
]);

const envValue = z.enum(["required", "optional", "unsupported"]);
const sha1Schema = z
  .string()
  .regex(/^[0-9a-fA-F]{40}$/)
  .transform((s) => s.toLowerCase());

const indexSchema = z.looseObject({
  formatVersion: z.number(),
  game: z.string(),
  versionId: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  summary: z.string().max(4096).optional(),
  files: z
    .array(
      z.looseObject({
        path: z.string().min(1).max(1024),
        hashes: z.looseObject({
          sha1: sha1Schema,
          sha512: z.string().optional(),
        }),
        env: z
          .looseObject({
            client: envValue.optional(),
            server: envValue.optional(),
          })
          .optional(),
        downloads: z.array(z.string()).min(1),
        fileSize: z.number().int().nonnegative(),
      }),
    )
    .max(20_000),
  dependencies: z.record(z.string(), z.string()),
});

/** One file the pack downloads. */
export interface PackFile {
  /** Forward slashes, relative to the game folder. */
  path: string;
  sha1: string;
  sha512?: string;
  url: string;
  size: number;
  /** Marked optional for the client: the user may leave it out. */
  optional: boolean;
}

export type PackLoader = "fabric" | "quilt" | "forge" | "neoforge";

export interface PackRequirements {
  gameVersion: string;
  /** null = vanilla. */
  loader: PackLoader | null;
  loaderVersion?: string;
}

export interface MrpackIndex {
  name: string;
  versionNumber: string;
  summary?: string;
  requires: PackRequirements;
  /** Files for the client (those it doesn't support are left out). */
  files: PackFile[];
}

/** The dependency keys of each loader, in the index. */
const LOADER_KEYS: Record<string, PackLoader> = {
  "fabric-loader": "fabric",
  "quilt-loader": "quilt",
  forge: "forge",
  neoforge: "neoforge",
};

/** Mod loaders this launcher can run. */
export const SUPPORTED_LOADERS: readonly PackLoader[] = ["fabric", "quilt"];

/** A path inside the game folder, refusing anything that could leave it. */
export function checkPackPath(path: string): string {
  const clean = path.replace(/^\.\//, "");
  try {
    if (/^[a-zA-Z]:/.test(clean) || clean.startsWith("/")) throw new Error();
    safeJoin("/", clean);
  } catch {
    throw new AppError(
      "MODPACK_UNSAFE_PATH",
      `The mod pack writes outside its folder: ${path}`,
    );
  }
  return clean;
}

function pickUrl(urls: readonly string[], path: string): string {
  for (const raw of urls) {
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" && ALLOWED_HOSTS.has(url.hostname))
        return url.href;
    } catch {
      // not a URL
    }
  }
  throw new AppError(
    "MODPACK_BAD_HOST",
    `The mod pack downloads ${path} from a site it may not use.`,
  );
}

/** Read and check an index. Throws `MODPACK_*` errors. */
export function parseIndex(json: unknown): MrpackIndex {
  const parsed = indexSchema.safeParse(json);
  if (!parsed.success)
    throw new AppError("MODPACK_INVALID", "This isn't a Modrinth mod pack.", {
      cause: parsed.error,
    });
  const index = parsed.data;
  if (index.formatVersion !== 1 || index.game !== "minecraft")
    throw new AppError(
      "MODPACK_FORMAT_UNSUPPORTED",
      `Mod pack format ${String(index.formatVersion)} for ${index.game} isn't supported.`,
    );

  const { minecraft, ...rest } = index.dependencies;
  if (!minecraft)
    throw new AppError(
      "MODPACK_INVALID",
      "The mod pack doesn't say its Minecraft version.",
    );
  let loader: PackLoader | null = null;
  let loaderVersion: string | undefined;
  for (const [key, version] of Object.entries(rest)) {
    const id = LOADER_KEYS[key];
    if (!id) continue;
    loader = id;
    loaderVersion = version;
  }

  const files: PackFile[] = [];
  const seen = new Set<string>();
  for (const f of index.files) {
    if (f.env?.client === "unsupported") continue;
    const path = checkPackPath(f.path);
    if (seen.has(path.toLowerCase())) continue;
    seen.add(path.toLowerCase());
    files.push({
      path,
      sha1: f.hashes.sha1,
      ...(f.hashes.sha512 && { sha512: f.hashes.sha512 }),
      url: pickUrl(f.downloads, path),
      size: f.fileSize,
      optional: f.env?.client === "optional",
    });
  }

  return {
    name: index.name,
    versionNumber: index.versionId,
    ...(index.summary && { summary: index.summary }),
    requires: {
      gameVersion: minecraft,
      loader,
      ...(loaderVersion !== undefined && { loaderVersion }),
    },
    files,
  };
}

/** Refuse packs whose loader this launcher can't run. */
export function assertSupported(requires: PackRequirements): void {
  if (requires.loader && !SUPPORTED_LOADERS.includes(requires.loader))
    throw new AppError(
      "MODPACK_LOADER_UNSUPPORTED",
      `This mod pack needs ${requires.loader}, which isn't supported yet.`,
    );
}
