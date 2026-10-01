import { z } from "zod";
import { AppError } from "../core/errors";
import type { Logger } from "../core/logger";
import type { FetchFn } from "../minecraft/downloader";
import type {
  ModSource,
  ModTarget,
  RemoteDependency,
  RemoteProject,
  RemoteVersion,
} from "./types";

export const MODRINTH_API = "https://api.modrinth.com/v2";
export const MODRINTH_SITE = "https://modrinth.com";
const SOURCE_ID = "modrinth";
/** Modrinth takes up to this many hashes per lookup; more are sent in several requests. */
export const HASH_BATCH = 500;
const MAX_RETRIES = 2;
const MAX_WAIT_MS = 60_000;

const projectSchema = z.looseObject({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  icon_url: z.string().nullable().optional(),
  project_type: z.string().optional(),
  downloads: z.number().optional(),
});
const searchSchema = z.looseObject({
  hits: z.array(
    z.looseObject({
      project_id: z.string(),
      slug: z.string(),
      title: z.string(),
      author: z.string().optional(),
      description: z.string().optional(),
      project_type: z.string().optional(),
      icon_url: z.string().nullable().optional(),
      downloads: z.number().optional(),
    }),
  ),
  total_hits: z.number().optional(),
});
const dependenciesSchema = z.looseObject({
  projects: z.array(projectSchema),
});
const membersSchema = z.array(
  z.looseObject({
    role: z.string().optional(),
    user: z.looseObject({ username: z.string() }),
  }),
);
const versionSchema = z.looseObject({
  id: z.string(),
  project_id: z.string(),
  version_number: z.string(),
  version_type: z.enum(["release", "beta", "alpha"]),
  loaders: z.array(z.string()),
  game_versions: z.array(z.string()),
  date_published: z.string().optional(),
  files: z.array(
    z.looseObject({
      url: z.string(),
      filename: z.string(),
      size: z.number(),
      primary: z.boolean().optional(),
      hashes: z.looseObject({
        sha1: z.string(),
        sha512: z.string().optional(),
      }),
    }),
  ),
  dependencies: z
    .array(
      z.looseObject({
        project_id: z.string().nullable().optional(),
        version_id: z.string().nullable().optional(),
        dependency_type: z.string(),
      }),
    )
    .optional(),
});
type ModrinthVersion = z.infer<typeof versionSchema>;

export interface ModrinthOptions {
  fetch: FetchFn;
  /** `ezlauncher/<version> (<contact>)`: Modrinth requires one that identifies the app. */
  userAgent: string;
  logger?: Logger;
  /** Replaceable in tests. */
  sleep?: (ms: number) => Promise<void>;
}

const CHANNEL_ORDER = ["release", "beta", "alpha"] as const;

/** Newest release, else newest beta, else newest alpha. */
export function pickVersion<
  T extends { version_type: string; date_published?: string | undefined },
>(versions: readonly T[]): T | undefined {
  const newest = [...versions].sort((a, b) =>
    (b.date_published ?? "").localeCompare(a.date_published ?? ""),
  );
  for (const channel of CHANNEL_ORDER) {
    const found = newest.find((v) => v.version_type === channel);
    if (found) return found;
  }
  return undefined;
}

function dependencyKind(type: string): RemoteDependency["kind"] | undefined {
  if (type === "required" || type === "optional" || type === "incompatible")
    return type;
  return undefined; // "embedded": already inside the jar
}

export function createModrinthSource({
  fetch,
  userAgent,
  logger,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}: ModrinthOptions): ModSource {
  /** When the rate limit window resets (ms since 1970); 0 = no need to wait. */
  let blockedUntil = 0;
  const pageUrl = (idOrSlug: string, projectType = "mod") =>
    `${MODRINTH_SITE}/${/^[a-z]+$/.test(projectType) ? projectType : "mod"}/${encodeURIComponent(idOrSlug)}`;
  const toProject = (p: z.infer<typeof projectSchema>): RemoteProject => ({
    sourceId: SOURCE_ID,
    projectId: p.id,
    slug: p.slug,
    name: p.title,
    author: "",
    ...(p.icon_url && { iconUrl: p.icon_url }),
    ...(p.project_type && { projectType: p.project_type }),
    pageUrl: pageUrl(p.slug, p.project_type),
  });

  function noteLimits(res: Response): number {
    const reset = Number(res.headers.get("x-ratelimit-reset") ?? "");
    const waitMs = Number.isFinite(reset)
      ? Math.min(Math.max(reset, 1) * 1000, MAX_WAIT_MS)
      : 1000;
    if (res.headers.get("x-ratelimit-remaining") === "0")
      blockedUntil = Date.now() + waitMs;
    return waitMs;
  }

  /** One API call: waits out the rate limit, retries a 429, and returns undefined for a 404. */
  async function call<T extends z.ZodType>(
    path: string,
    schema: T,
    { signal, body }: { signal?: AbortSignal; body?: unknown } = {},
  ): Promise<z.infer<T> | undefined> {
    for (let attempt = 0; ; attempt++) {
      const wait = blockedUntil - Date.now();
      if (wait > 0) {
        logger?.info(`modrinth rate limit: waiting ${Math.ceil(wait / 1000)}s`);
        await sleep(wait);
      }
      if (signal?.aborted) throw new AppError("CANCELLED", "Cancelled.");
      let res: Response;
      try {
        res = await fetch(`${MODRINTH_API}${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "User-Agent": userAgent,
            ...(body !== undefined && { "Content-Type": "application/json" }),
          },
          ...(body !== undefined && { body: JSON.stringify(body) }),
          ...(signal && { signal }),
        });
      } catch (err) {
        if (signal?.aborted) throw new AppError("CANCELLED", "Cancelled.");
        throw new AppError("OFFLINE", "Can't reach Modrinth.", { cause: err });
      }
      const waitMs = noteLimits(res);
      if (res.status === 429 && attempt < MAX_RETRIES) {
        blockedUntil = Date.now() + waitMs;
        continue;
      }
      if (res.status === 404) return undefined;
      if (!res.ok)
        throw new AppError(
          "MODRINTH_ERROR",
          `Modrinth answered ${res.status} for ${path}.`,
        );
      const parsed = schema.safeParse(await res.json().catch(() => undefined));
      if (!parsed.success)
        throw new AppError(
          "MODRINTH_ERROR",
          `Unexpected answer from Modrinth for ${path}.`,
          {
            cause: parsed.error,
          },
        );
      return parsed.data;
    }
  }

  function toVersion(v: ModrinthVersion, sha1?: string): RemoteVersion | null {
    const file =
      (sha1 && v.files.find((f) => f.hashes.sha1.toLowerCase() === sha1)) ||
      v.files.find((f) => f.primary) ||
      v.files[0];
    if (!file) return null;
    const dependencies: RemoteDependency[] = [];
    for (const d of v.dependencies ?? []) {
      const kind = dependencyKind(d.dependency_type);
      if (!kind || (!d.project_id && !d.version_id)) continue;
      dependencies.push({
        kind,
        ...(d.project_id && { projectId: d.project_id }),
        ...(d.version_id && { versionId: d.version_id }),
      });
    }
    return {
      sourceId: SOURCE_ID,
      projectId: v.project_id,
      versionId: v.id,
      versionNumber: v.version_number,
      channel: v.version_type,
      loaders: v.loaders,
      gameVersions: v.game_versions,
      file: {
        url: file.url,
        fileName: file.filename,
        size: file.size,
        sha1: file.hashes.sha1.toLowerCase(),
        ...(file.hashes.sha512 && { sha512: file.hashes.sha512 }),
      },
      dependencies,
    };
  }

  const q = (value: unknown) => encodeURIComponent(JSON.stringify(value));

  async function author(projectId: string, signal?: AbortSignal) {
    const members = await call(
      `/project/${encodeURIComponent(projectId)}/members`,
      membersSchema,
      signal ? { signal } : {},
    ).catch(() => undefined);
    const owner = members?.find((m) => m.role === "Owner") ?? members?.[0];
    return owner?.user.username ?? "";
  }

  return {
    id: SOURCE_ID,
    displayName: "Modrinth",
    pageUrl,

    async findExact(query, target, signal) {
      const wanted = query.trim().toLowerCase();
      if (!wanted) return [];
      const opts = signal ? { signal } : {};
      const same = (s: string) => s.trim().toLowerCase() === wanted;

      // 1. The query as a slug or id.
      const direct = /^[\w!@$()`.+,"\-']{1,64}$/.test(query.trim())
        ? await call(
            `/project/${encodeURIComponent(query.trim())}`,
            projectSchema,
            opts,
          )
        : undefined;
      // 2. A search, keeping only exact name or slug matches.
      const type = target.projectType ?? "mod";
      const facets = [
        [`project_type:${type}`],
        ...(type === "mod"
          ? [target.loaders.map((l) => `categories:${l}`)]
          : []),
        [`versions:${target.gameVersion}`],
      ];
      const search = await call(
        `/search?query=${encodeURIComponent(query.trim())}&facets=${q(facets)}&limit=20`,
        searchSchema,
        opts,
      );

      const found = new Map<string, RemoteProject>();
      for (const hit of search?.hits ?? []) {
        if (!same(hit.title) && !same(hit.slug)) continue;
        found.set(hit.project_id, {
          sourceId: SOURCE_ID,
          projectId: hit.project_id,
          slug: hit.slug,
          name: hit.title,
          author: hit.author ?? "",
          ...(hit.icon_url && { iconUrl: hit.icon_url }),
          ...(hit.downloads !== undefined && { downloads: hit.downloads }),
          projectType: type,
          pageUrl: pageUrl(hit.slug, type),
        });
      }
      if (
        direct &&
        (direct.project_type ?? "mod") === type &&
        !found.has(direct.id)
      ) {
        found.set(direct.id, {
          sourceId: SOURCE_ID,
          projectId: direct.id,
          slug: direct.slug,
          name: direct.title,
          author: await author(direct.id, signal),
          ...(direct.icon_url && { iconUrl: direct.icon_url }),
          ...(direct.downloads !== undefined && {
            downloads: direct.downloads,
          }),
          projectType: type,
          pageUrl: pageUrl(direct.slug, type),
        });
      }
      return [...found.values()];
    },

    async search(query, { projectType, gameVersion, offset, limit }, signal) {
      const facets = [
        [`project_type:${projectType}`],
        ...(gameVersion ? [[`versions:${gameVersion}`]] : []),
      ];
      const result = await call(
        `/search?query=${encodeURIComponent(query.trim())}&facets=${q(facets)}&offset=${Math.max(0, Math.floor(offset))}&limit=${Math.min(100, Math.max(1, Math.floor(limit)))}`,
        searchSchema,
        signal ? { signal } : {},
      );
      const hits = (result?.hits ?? []).map((hit): RemoteProject => ({
        sourceId: SOURCE_ID,
        projectId: hit.project_id,
        slug: hit.slug,
        name: hit.title,
        author: hit.author ?? "",
        ...(hit.description && { description: hit.description }),
        ...(hit.icon_url && { iconUrl: hit.icon_url }),
        ...(hit.downloads !== undefined && { downloads: hit.downloads }),
        projectType: hit.project_type ?? projectType,
        pageUrl: pageUrl(hit.slug, hit.project_type ?? projectType),
      }));
      return { hits, total: result?.total_hits ?? hits.length };
    },

    async projectDependencies(projectId, signal) {
      const result = await call(
        `/project/${encodeURIComponent(projectId)}/dependencies`,
        dependenciesSchema,
        signal ? { signal } : {},
      );
      return (result?.projects ?? []).map(toProject);
    },

    async getCompatibleVersion(projectId, target: ModTarget, signal) {
      const versions = target.gameVersion
        ? `&game_versions=${q([target.gameVersion])}`
        : "";
      const list = await call(
        `/project/${encodeURIComponent(projectId)}/version?loaders=${q(target.loaders)}${versions}`,
        z.array(versionSchema),
        signal ? { signal } : {},
      );
      const picked = pickVersion(list ?? []);
      return picked ? toVersion(picked) : null;
    },

    async getVersion(versionId, signal, fileSha1) {
      const v = await call(
        `/version/${encodeURIComponent(versionId)}`,
        versionSchema,
        signal ? { signal } : {},
      );
      const version = v && toVersion(v, fileSha1?.toLowerCase());
      if (!version)
        throw new AppError(
          "MODRINTH_ERROR",
          `Modrinth has no version ${versionId}.`,
        );
      return version;
    },

    async getProjects(ids, signal) {
      if (ids.length === 0) return [];
      const list = await call(
        `/projects?ids=${q(ids)}`,
        z.array(projectSchema),
        {
          ...(signal && { signal }),
        },
      );
      return (list ?? []).map(toProject);
    },

    async identifyFiles(sha1s, signal) {
      const result = new Map<string, RemoteVersion>();
      const hashes = [...new Set(sha1s.map((h) => h.toLowerCase()))];
      for (let i = 0; i < hashes.length; i += HASH_BATCH) {
        const batch = hashes.slice(i, i + HASH_BATCH);
        const found = await call(
          "/version_files",
          z.record(z.string(), versionSchema),
          {
            body: { hashes: batch, algorithm: "sha1" },
            ...(signal && { signal }),
          },
        );
        for (const [hash, v] of Object.entries(found ?? {})) {
          const version = toVersion(v, hash.toLowerCase());
          if (version) result.set(hash.toLowerCase(), version);
        }
      }
      return result;
    },
  };
}
