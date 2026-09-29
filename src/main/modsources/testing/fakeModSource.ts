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
}

/** Test helper: an in-memory mod site. Versions are listed newest first. */
export function createFakeModSource(
  projects: { projectId: string; slug?: string; name: string }[],
  versions: FakeVersionInput[],
): ModSource & { calls: string[] } {
  const calls: string[] = [];
  const project = (p: (typeof projects)[number]): RemoteProject => ({
    sourceId: "fake",
    projectId: p.projectId,
    slug: p.slug ?? p.projectId,
    name: p.name,
    author: "someone",
    pageUrl: `https://fake/mod/${p.projectId}`,
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
  });
  const fits = (v: FakeVersionInput, t: ModTarget) =>
    (v.loaders ?? ["fabric"]).some((l) => t.loaders.includes(l)) &&
    (v.gameVersions ?? ["1.18.2"]).includes(t.gameVersion);

  return {
    id: "fake",
    displayName: "Fake",
    calls,
    pageUrl: (id) => `https://fake/mod/${id}`,
    findExact(query) {
      calls.push(`findExact ${query}`);
      const q = query.trim().toLowerCase();
      return Promise.resolve(
        projects
          .filter(
            (p) =>
              p.name.toLowerCase() === q ||
              (p.slug ?? p.projectId).toLowerCase() === q,
          )
          .map(project),
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
    identifyFiles(sha1s) {
      calls.push(`identifyFiles ${sha1s.length}`);
      const found = new Map<string, RemoteVersion>();
      for (const v of versions)
        if (sha1s.includes(v.sha1)) found.set(v.sha1, version(v));
      return Promise.resolve(found);
    },
  };
}
