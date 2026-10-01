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

describe("findExact", () => {
  it("keeps only exact name or slug matches, merges the slug lookup, and filters the search", async () => {
    const { source, seen } = fakeModrinth({
      "/project/Sodium": {
        json: {
          id: "AANobbMI",
          slug: "sodium",
          title: "Sodium",
          project_type: "mod",
        },
      },
      "/project/AANobbMI/members": {
        json: [{ role: "Owner", user: { username: "jellysquid3" } }],
      },
      "/search": {
        json: {
          hits: [
            {
              project_id: "AANobbMI",
              slug: "sodium",
              title: "Sodium",
              author: "jellysquid3",
              downloads: 51_000_000,
            },
            {
              project_id: "x",
              slug: "sodium-extra",
              title: "Sodium Extra",
              author: "a",
            },
            {
              project_id: "y",
              slug: "rubidium",
              title: "SODIUM ",
              author: "b",
            },
          ],
        },
      },
    });
    const found = await source.findExact(" Sodium ", target);
    expect(found.map((p) => p.projectId)).toEqual(["AANobbMI", "y"]);
    expect(found[0]).toMatchObject({
      name: "Sodium",
      author: "jellysquid3",
      pageUrl: "https://modrinth.com/mod/sodium",
      downloads: 51_000_000,
    });

    const search = seen.find((s) => s.url.includes("/search?"));
    const facets: unknown = JSON.parse(
      decodeURIComponent(
        new URL(search?.url ?? "").searchParams.get("facets") ?? "",
      ),
    );
    expect(facets).toEqual([
      ["project_type:mod"],
      ["categories:quilt", "categories:fabric"],
      ["versions:1.18.2"],
    ]);
    expect(
      seen.every((s) => s.userAgent?.startsWith("ezlauncher/test (")),
    ).toBe(true);
  });

  it("treats an unknown slug as no match and skips non-mods", async () => {
    const { source } = fakeModrinth({
      "/project/Iris Shaders": undefined as unknown as Reply,
      "/search": { json: { hits: [] } },
    });
    expect(await source.findExact("Iris Shaders", target)).toEqual([]);

    const pack = fakeModrinth({
      "/project/fabulously-optimized": {
        json: {
          id: "1",
          slug: "fabulously-optimized",
          title: "FO",
          project_type: "modpack",
        },
      },
      "/search": { json: { hits: [] } },
    });
    expect(await pack.source.findExact("fabulously-optimized", target)).toEqual(
      [],
    );
  });
});

const facetsOf = (url: string): unknown =>
  JSON.parse(decodeURIComponent(new URL(url).searchParams.get("facets") ?? ""));

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

  it("finds packs by exact name without a loader filter", async () => {
    const { source, seen } = fakeModrinth({
      "/project/faithful-32x": {
        json: {
          id: "F1",
          slug: "faithful-32x",
          title: "Faithful 32x",
          project_type: "resourcepack",
        },
      },
      "/project/F1/members": { json: [] },
      "/search": { json: { hits: [] } },
    });
    const found = await source.findExact("faithful-32x", {
      gameVersion: "1.20.1",
      loaders: ["minecraft"],
      projectType: "resourcepack",
    });
    expect(found.map((p) => p.pageUrl)).toEqual([
      "https://modrinth.com/resourcepack/faithful-32x",
    ]);
    const search = seen.find((s) => s.url.includes("/search?"));
    expect(facetsOf(search!.url)).toEqual([
      ["project_type:resourcepack"],
      ["versions:1.20.1"],
    ]);
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
