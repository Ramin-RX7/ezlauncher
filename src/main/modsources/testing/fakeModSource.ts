import type {
  ModSource,
  ModTarget,
  RemoteDependency,
  RemoteProject,
  RemoteVersion,
} from "../types";

export interface FakeVersionInput {
  projectId: string;
  versionId: string;
  versionNumber?: string;
  channel?: RemoteVersion["channel"];
  loaders?: string[];
  gameVersions?: string[];
  sha1: string;
  size?: number;
  url?: string;
  fileName?: string;
  dependencies?: RemoteDependency[];
  published?: string;
  changelog?: string;
}

/** Test helper: an in-memory mod site. Versions are listed newest first. */
export function createFakeModSource(
  projects: {
    projectId: string;
    slug?: string;
    name: string;
    /** Default `mod`. */
    projectType?: string;
    /** Project ids it says it needs. */
    needs?: string[];
  }[],
  versions: FakeVersionInput[],
): ModSource & { calls: string[] } {
  const calls: string[] = [];
  const typeOf = (p: (typeof projects)[number]) => p.projectType ?? "mod";
  const project = (p: (typeof projects)[number]): RemoteProject => ({
    sourceId: "fake",
    projectId: p.projectId,
    slug: p.slug ?? p.projectId,
    name: p.name,
    author: "someone",
    projectType: typeOf(p),
    pageUrl: `https://fake/${typeOf(p)}/${p.projectId}`,
  });
  const version = (v: FakeVersionInput): RemoteVersion => ({
    sourceId: "fake",
    projectId: v.projectId,
    versionId: v.versionId,
    versionNumber: v.versionNumber ?? v.versionId,
    channel: v.channel ?? "release",
    loaders: v.loaders ?? ["fabric"],
    gameVersions: v.gameVersions ?? ["1.18.2"],
    file: {
      url: v.url ?? `https://fake/files/${v.sha1}.jar`,
      fileName:
        v.fileName ?? `${v.projectId}-${v.versionNumber ?? v.versionId}.jar`,
      size: v.size ?? 10,
      sha1: v.sha1,
    },
    dependencies: v.dependencies ?? [],
    ...(v.published && { published: v.published }),
    ...(v.changelog && { changelog: v.changelog }),
  });
  const fits = (v: FakeVersionInput, t: ModTarget) =>
    (v.loaders ?? ["fabric"]).some((l) => t.loaders.includes(l)) &&
    (t.gameVersion === "" ||
      (v.gameVersions ?? ["1.18.2"]).includes(t.gameVersion));

  return {
    id: "fake",
    displayName: "Fake",
    calls,
    pageUrl: (id, type = "mod") => `https://fake/${type}/${id}`,
    findExact(query, target) {
      calls.push(`findExact ${query}`);
      const q = query.trim().toLowerCase();
      return Promise.resolve(
        projects
          .filter(
            (p) =>
              typeOf(p) === (target.projectType ?? "mod") &&
              (p.name.toLowerCase() === q ||
                (p.slug ?? p.projectId).toLowerCase() === q),
          )
          .map(project),
      );
    },
    search(query, { projectType, gameVersion, offset, limit }) {
      calls.push(`search ${query} ${projectType} ${offset}`);
      const q = query.trim().toLowerCase();
      const all = projects.filter(
        (p) =>
          typeOf(p) === projectType &&
          p.name.toLowerCase().includes(q) &&
          (!gameVersion ||
            versions.some(
              (v) =>
                v.projectId === p.projectId &&
                (v.gameVersions ?? ["1.18.2"]).includes(gameVersion),
            )),
      );
      return Promise.resolve({
        hits: all.slice(offset, offset + limit).map(project),
        total: all.length,
      });
    },
    projectDependencies(projectId) {
      const needs =
        projects.find((p) => p.projectId === projectId)?.needs ?? [];
      return Promise.resolve(
        projects.filter((p) => needs.includes(p.projectId)).map(project),
      );
    },
    getCompatibleVersion(projectId, target) {
      calls.push(`getCompatibleVersion ${projectId}`);
      const list = versions.filter(
        (v) => v.projectId === projectId && fits(v, target),
      );
      const pick =
        list.find((v) => (v.channel ?? "release") === "release") ??
        list.find((v) => v.channel === "beta") ??
        list.find((v) => v.channel === "alpha");
      return Promise.resolve(pick ? version(pick) : null);
    },
    listVersions(projectId, { loaders } = {}) {
      calls.push(`listVersions ${projectId}`);
      return Promise.resolve(
        versions
          .filter(
            (v) =>
              v.projectId === projectId &&
              (!loaders ||
                (v.loaders ?? ["fabric"]).some((l) => loaders.includes(l))),
          )
          .map(version),
      );
    },
    getVersion(versionId) {
      calls.push(`getVersion ${versionId}`);
      const v = versions.find((x) => x.versionId === versionId);
      return v
        ? Promise.resolve(version(v))
        : Promise.reject(new Error("no version"));
    },
    getProjects(ids) {
      return Promise.resolve(
        projects.filter((p) => ids.includes(p.projectId)).map(project),
      );
    },
    latestVersions(sha1s, target) {
      calls.push(`latestVersions ${sha1s.length}`);
      const found = new Map<string, RemoteVersion>();
      for (const sha1 of sha1s) {
        const known = versions.find((v) => v.sha1 === sha1);
        if (!known) continue;
        const newest = versions.find(
          (v) => v.projectId === known.projectId && fits(v, target),
        );
        if (newest) found.set(sha1, version(newest));
      }
      return Promise.resolve(found);
    },
    identifyFiles(sha1s) {
      calls.push(`identifyFiles ${sha1s.length}`);
      const found = new Map<string, RemoteVersion>();
      for (const v of versions)
        if (sha1s.includes(v.sha1)) found.set(v.sha1, version(v));
      return Promise.resolve(found);
    },
  };
}
