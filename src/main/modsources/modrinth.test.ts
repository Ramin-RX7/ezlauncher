import { describe, expect, it } from "vitest";
import type { FetchFn } from "../minecraft/downloader";
import {
  createModrinthSource,
  HASH_BATCH,
  MODRINTH_API,
  pickVersion,
} from "./modrinth";

interface Seen {
  url: string;
  method: string;
  body?: unknown;
  userAgent?: string;
}

type Reply =
  | { status?: number; json?: unknown; headers?: Record<string, string> }
  | ((seen: Seen) => {
      status?: number;
      json?: unknown;
      headers?: Record<string, string>;
    });

/** A fake Modrinth: answers by path (without the API base); records every request. */
function fakeModrinth(routes: Record<string, Reply | Reply[]>) {
  const seen: Seen[] = [];
  const fetch: FetchFn = (url, init) => {
    const headers = new Headers(init?.headers);
    const entry: Seen = {
      url,
      method: init?.method ?? "GET",
      ...(typeof init?.body === "string" && {
        body: JSON.parse(init.body) as unknown,
      }),
      ...(headers.get("User-Agent") && {
        userAgent: headers.get("User-Agent") ?? "",
      }),
    };
    seen.push(entry);
    const path = url.slice(MODRINTH_API.length);
    const key = Object.keys(routes).find(
      (k) => path === k || path.startsWith(`${k}?`),
    );
    let reply = key ? routes[key] : undefined;
    if (Array.isArray(reply))
      reply = reply.length > 1 ? reply.shift() : reply[0];
    const r = typeof reply === "function" ? reply(entry) : reply;
    if (!r) return Promise.resolve(new Response("not found", { status: 404 }));
    return Promise.resolve(
      new Response(JSON.stringify(r.json ?? null), {
        status: r.status ?? 200,
        headers: r.headers ?? {},
      }),
    );
  };
  const sleeps: number[] = [];
  const source = createModrinthSource({
    fetch,
    userAgent: "ezlauncher/test (github.com/Ramin-RX7/ezlauncher)",
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  return { source, seen, sleeps };
}

const target = { gameVersion: "1.18.2", loaders: ["quilt", "fabric"] };
const version = (
  id: string,
  type: string,
  date: string,
  extra: object = {},
) => ({
  id,
  project_id: "AANobbMI",
  version_number: id,
  version_type: type,
  loaders: ["fabric"],
  game_versions: ["1.18.2"],
  date_published: date,
  files: [
    {
      url: `https://cdn/${id}-extra.jar`,
      filename: `${id}-sources.jar`,
      size: 1,
      primary: false,
      hashes: { sha1: "a".repeat(40) },
    },
    {
      url: `https://cdn/${id}.jar`,
      filename: `${id}.jar`,
      size: 2,
      primary: true,
      hashes: { sha1: "B".repeat(40) },
    },
  ],
  dependencies: [
    { project_id: "P7dR8mSH", dependency_type: "required" },
    { project_id: "emb", dependency_type: "embedded" },
  ],
  ...extra,
});

const facetsOf = (url: string): unknown =>
  JSON.parse(decodeURIComponent(new URL(url).searchParams.get("facets") ?? ""));

describe("mods", () => {
  it("searches mods for the profile's loaders and version, a page at a time", async () => {
    const { source, seen } = fakeModrinth({
      "/search": {
        json: {
          total_hits: 41,
          hits: [
            {
              project_id: "AANobbMI",
              slug: "sodium",
              title: "Sodium",
              author: "jellysquid3",
              description: "Rendering engine",
              downloads: 51_000_000,
            },
          ],
        },
      },
    });
    const page = await source.search("sodium", {
      projectType: "mod",
      gameVersion: "1.18.2",
      loaders: ["quilt", "fabric"],
      offset: 20,
      limit: 20,
    });
    expect(page.total).toBe(41);
    expect(page.hits[0]).toMatchObject({
      projectId: "AANobbMI",
      name: "Sodium",
      author: "jellysquid3",
      description: "Rendering engine",
      pageUrl: "https://modrinth.com/mod/sodium",
    });
    expect(facetsOf(seen[0]!.url)).toEqual([
      ["project_type:mod"],
      ["categories:quilt", "categories:fabric"],
      ["versions:1.18.2"],
    ]);
    expect(new URL(seen[0]!.url).searchParams.get("offset")).toBe("20");
    expect(
      seen.every((s) => s.userAgent?.startsWith("ezlauncher/test (")),
    ).toBe(true);
  });
});

describe("shader packs", () => {
  it("searches every shader and says which loaders each is tagged for", async () => {
    const { source, seen } = fakeModrinth({
      "/search": {
        json: {
          hits: [
            {
              project_id: "C1",
              slug: "complementary-reimagined",
              title: "Complementary Reimagined",
              project_type: "shader",
              categories: ["iris", "optifine", "realistic"],
            },
            {
              project_id: "O1",
              slug: "old-pack",
              title: "Old Pack",
              project_type: "shader",
              categories: ["optifine", "cartoon"],
            },
          ],
          total_hits: 2,
        },
      },
    });
    const page = await source.search("", {
      projectType: "shader",
      gameVersion: "26.3",
      offset: 0,
      limit: 20,
    });
    expect(page.hits.map((h) => h.loaders)).toEqual([
      ["iris", "optifine"],
      ["optifine"],
    ]);
    expect(page.hits[0]?.pageUrl).toBe(
      "https://modrinth.com/shader/complementary-reimagined",
    );
    expect(facetsOf(seen[0]!.url)).toEqual([
      ["project_type:shader"],
      ["versions:26.3"],
    ]);
  });
});

describe("mod packs", () => {
  it("searches mod packs with their loaders and Minecraft versions", async () => {
    const { source, seen } = fakeModrinth({
      "/search": {
        json: {
          hits: [
            {
              project_id: "fo",
              slug: "fabulously-optimized",
              title: "Fabulously Optimized",
              project_type: "modpack",
              categories: ["fabric", "optimization"],
              versions: ["1.21.1", "26.3"],
            },
            {
              project_id: "z",
              slug: "zombies",
              title: "Zombies",
              project_type: "modpack",
              categories: ["forge", "combat"],
            },
          ],
          total_hits: 2,
        },
      },
    });
    const { hits } = await source.search("", {
      projectType: "modpack",
      offset: 0,
      limit: 20,
    });
    expect(decodeURIComponent(seen[0]!.url)).toContain(
      '[["project_type:modpack"]]',
    );
    expect(hits.map((h) => [h.pageUrl, h.loaders, h.gameVersions])).toEqual([
      [
        "https://modrinth.com/modpack/fabulously-optimized",
        ["fabric"],
        ["1.21.1", "26.3"],
      ],
      ["https://modrinth.com/modpack/zombies", ["forge"], undefined],
    ]);
  });

  it("lists every version of a project, newest first", async () => {
    const { source, seen } = fakeModrinth({
      "/project/fo/version": {
        json: [
          version("old", "release", "2024-01-01"),
          version("new", "beta", "2025-01-01"),
        ],
      },
    });
    const list = await source.listVersions("fo", { loaders: ["fabric"] });
    expect(
      list.map((v) => [v.versionId, v.published, v.file.fileName]),
    ).toEqual([
      ["new", "2025-01-01", "new.jar"],
      ["old", "2024-01-01", "old.jar"],
    ]);
    expect(decodeURIComponent(seen[0]!.url)).toContain('loaders=["fabric"]');
  });
});

describe("resource packs", () => {
  it("searches one kind of project for a version, a page at a time", async () => {
    const { source, seen } = fakeModrinth({
      "/search": {
        json: {
          hits: [
            {
              project_id: "F1",
              slug: "faithful-32x",
              title: "Faithful 32x",
              author: "Faithful",
              description: "32x textures",
              project_type: "resourcepack",
              downloads: 4_900_000,
            },
          ],
          total_hits: 41,
        },
      },
    });
    const page = await source.search("faithful", {
      projectType: "resourcepack",
      gameVersion: "1.20.1",
      offset: 20,
      limit: 20,
    });
    expect(page.total).toBe(41);
    expect(page.hits[0]).toMatchObject({
      name: "Faithful 32x",
      description: "32x textures",
      projectType: "resourcepack",
      pageUrl: "https://modrinth.com/resourcepack/faithful-32x",
    });
    const url = new URL(seen[0]!.url);
    expect(facetsOf(seen[0]!.url)).toEqual([
      ["project_type:resourcepack"],
      ["versions:1.20.1"],
    ]);
    expect(url.searchParams.get("offset")).toBe("20");
    expect(url.searchParams.get("limit")).toBe("20");
  });

  it("asks for any Minecraft version when none is given", async () => {
    const { source, seen } = fakeModrinth({
      "/project/F1/version": {
        json: [
          version("1", "release", "2024-01-01", { loaders: ["minecraft"] }),
        ],
      },
    });
    expect(
      await source.getCompatibleVersion("F1", {
        gameVersion: "",
        loaders: ["minecraft"],
      }),
    ).toMatchObject({ versionId: "1" });
    expect(seen[0]!.url).not.toContain("game_versions");
  });

  it("lists the projects a project needs, with their kind", async () => {
    const { source } = fakeModrinth({
      "/project/fresh-animations/dependencies": {
        json: {
          projects: [
            {
              id: "E1",
              slug: "entity-model-features",
              title: "Entity Model Features",
              project_type: "mod",
            },
          ],
          versions: [],
        },
      },
    });
    expect(await source.projectDependencies("fresh-animations")).toEqual([
      expect.objectContaining({
        name: "Entity Model Features",
        projectType: "mod",
        pageUrl: "https://modrinth.com/mod/entity-model-features",
      }),
    ]);
  });
});

describe("versions", () => {
  it("picks the newest release before any beta or alpha, and the primary file", async () => {
    const { source, seen } = fakeModrinth({
      "/project/AANobbMI/version": {
        json: [
          version("0.5.0-beta", "beta", "2024-03-01"),
          version("0.4.1", "release", "2024-01-01"),
          version("0.4.0", "release", "2023-06-01"),
          version("0.6.0-alpha", "alpha", "2024-05-01"),
        ],
      },
    });
    const v = await source.getCompatibleVersion("AANobbMI", target);
    expect(v).toMatchObject({
      versionId: "0.4.1",
      channel: "release",
      file: {
        url: "https://cdn/0.4.1.jar",
        fileName: "0.4.1.jar",
        sha1: "b".repeat(40),
      },
      dependencies: [{ projectId: "P7dR8mSH", kind: "required" }],
    });
    const url = new URL(seen[0]?.url ?? "");
    expect(JSON.parse(url.searchParams.get("loaders") ?? "")).toEqual([
      "quilt",
      "fabric",
    ]);
    expect(JSON.parse(url.searchParams.get("game_versions") ?? "")).toEqual([
      "1.18.2",
    ]);
  });

  it("falls back to beta, then alpha", () => {
    const beta = { version_type: "beta", date_published: "2" };
    const alpha = { version_type: "alpha", date_published: "3" };
    expect(pickVersion([alpha, beta])).toBe(beta);
    expect(pickVersion([alpha])).toBe(alpha);
    expect(pickVersion<typeof beta>([])).toBeUndefined();
  });

  it("returns null when no version fits", async () => {
    const { source } = fakeModrinth({ "/project/x/version": { json: [] } });
    expect(await source.getCompatibleVersion("x", target)).toBeNull();
  });
});

describe("identifyFiles", () => {
  it("sends hashes in batches and uses the file that matched", async () => {
    const hashes = Array.from({ length: HASH_BATCH + 3 }, (_, i) =>
      i.toString(16).padStart(40, "0"),
    );
    const { source, seen } = fakeModrinth({
      "/version_files": (s) => {
        const sent = (s.body as { hashes: string[] }).hashes;
        return {
          json: sent.includes(hashes[1] ?? "")
            ? {
                [hashes[1] ?? ""]: version("1.0", "release", "1", {
                  files: [
                    {
                      url: "u",
                      filename: "m.jar",
                      size: 3,
                      primary: true,
                      hashes: { sha1: hashes[1] },
                    },
                  ],
                }),
              }
            : {},
        };
      },
    });
    const found = await source.identifyFiles(hashes);
    const posts = seen.filter((s) => s.method === "POST");
    expect(
      posts.map((p) => (p.body as { hashes: string[] }).hashes.length),
    ).toEqual([HASH_BATCH, 3]);
    expect((posts[0]?.body as { algorithm: string }).algorithm).toBe("sha1");
    expect([...found.keys()]).toEqual([hashes[1]]);
    expect(found.get(hashes[1] ?? "")?.file.fileName).toBe("m.jar");
  });
});

describe("latestVersions", () => {
  it("asks for the newest version of each file for the target, with its changelog", async () => {
    const hash = "a".repeat(40);
    const { source, seen } = fakeModrinth({
      "/version_files/update": () => ({
        json: {
          [hash]: version("2.0", "release", "2", { changelog: "- New" }),
        },
      }),
    });
    const found = await source.latestVersions([hash.toUpperCase()], target);
    const body = seen.find((s) => s.method === "POST")?.body as {
      hashes: string[];
      algorithm: string;
      loaders: string[];
      game_versions: string[];
    };
    expect(body).toEqual({
      hashes: [hash],
      algorithm: "sha1",
      loaders: target.loaders,
      game_versions: [target.gameVersion],
    });
    expect(found.get(hash)?.versionNumber).toBe("2.0");
    expect(found.get(hash)?.changelog).toBe("- New");
  });
});

describe("rate limit", () => {
  it("waits for the reset when nothing is left, and retries after a 429", async () => {
    const { source, sleeps, seen } = fakeModrinth({
      "/project/x/version": [
        {
          json: [],
          headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "5" },
        },
        {
          status: 429,
          headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2" },
        },
        { json: [] },
      ],
    });
    await source.getCompatibleVersion("x", target); // leaves 0 requests
    await source.getCompatibleVersion("x", target); // waits, gets 429, waits, retries
    expect(seen).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]).toBeGreaterThan(4000);
  });

  it("reports offline when Modrinth can't be reached", async () => {
    const source = createModrinthSource({
      fetch: () => Promise.reject(new TypeError("fetch failed")),
      userAgent: "t",
    });
    await expect(
      source.getCompatibleVersion("x", target),
    ).rejects.toMatchObject({
      code: "OFFLINE",
    });
  });
});
