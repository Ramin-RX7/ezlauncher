import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDownloader } from "../minecraft/downloader";
import { createPaths, type Paths } from "../minecraft/paths";
import { createFakeFetch, sha1 } from "../minecraft/testing/fakeFetch";
import { createModLibrary } from "../profiles/mods";
import { fabricMod } from "../profiles/testing/modJars";
import { downloadPlan } from "./downloadMods";
import { resolveInstall } from "./resolveDependencies";
import { createFakeModSource } from "./testing/fakeModSource";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-download-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const profile = { id: "p", gameVersion: "1.18.2", loader: { id: "fabric" } };
const target = { gameVersion: "1.18.2", loaders: ["fabric"] };
const sodiumJar = fabricMod("sodium", "0.4.1");
const apiJar = fabricMod("fabric-api", "0.76.0");

function setup() {
  const files = createFakeFetch({
    "https://fake/sodium.jar": sodiumJar,
    "https://fake/fabric-api.jar": apiJar,
  });
  const source = createFakeModSource(
    [
      { projectId: "sodium", name: "Sodium" },
      { projectId: "fabric-api", name: "Fabric API" },
    ],
    [
      {
        projectId: "sodium",
        versionId: "s1",
        sha1: sha1(sodiumJar),
        size: sodiumJar.length,
        url: "https://fake/sodium.jar",
        fileName: "sodium-0.4.1.jar",
        dependencies: [{ projectId: "fabric-api", kind: "required" }],
      },
      {
        projectId: "fabric-api",
        versionId: "f1",
        sha1: sha1(apiJar),
        size: apiJar.length,
        url: "https://fake/fabric-api.jar",
        fileName: "fabric-api-0.76.0.jar",
      },
    ],
  );
  const downloader = createDownloader({
    fetch: files.fetch,
    userAgent: "t",
    retries: 0,
  });
  const library = createModLibrary({ paths });
  const deps = { downloader, paths, library, source };
  const planFor = async (versionId: string) =>
    resolveInstall(
      source,
      await source.getVersion(versionId),
      target,
      await library.view(profile),
    );
  return { files, source, library, deps, planFor };
}

describe("downloadPlan", () => {
  it("downloads a mod and its required dependency, and enables both", async () => {
    const { library, deps, planFor } = setup();
    await downloadPlan(deps, await planFor("s1"), "p");

    const list = await library.list(profile);
    expect(list.map((m) => [m.modId, m.enabled, m.source?.projectId])).toEqual([
      ["fabric-api", true, "fabric-api"],
      ["sodium", true, "sodium"],
    ]);
    expect(list[1]?.source?.pageUrl).toBe("https://fake/mod/sodium");
    expect((await readdir(paths.modsDir("p"))).sort()).toEqual([
      "fabric-api-0.76.0.jar",
      "sodium-0.4.1.jar",
    ]);
  });

  it("reuses a dependency that is already in the library", async () => {
    const { files, library, deps, planFor } = setup();
    await downloadPlan(deps, await planFor("f1"), "p");
    files.requests.length = 0;

    const plan = await planFor("s1");
    expect(plan.items.map((i) => i.action)).toEqual(["download", "reuse"]);
    await downloadPlan(deps, plan, "p");
    expect(files.requests).toEqual(["https://fake/sodium.jar"]);
    expect((await library.list(profile)).every((m) => m.enabled)).toBe(true);
  });

  it("leaves nothing half-added when a download fails", async () => {
    const { files, library, deps, planFor } = setup();
    Reflect.deleteProperty(files.routes, "https://fake/sodium.jar");
    await expect(
      downloadPlan(deps, await planFor("s1"), "p"),
    ).rejects.toMatchObject({
      code: "DOWNLOAD_FAILED",
    });
    expect(await library.list()).toEqual([]);
    expect(await readdir(paths.modsStoreDir).catch(() => [])).toEqual([]);
    expect(await readdir(paths.modsDir("p")).catch(() => [])).toEqual([]);
  });

  it("leaves nothing half-added when cancelled", async () => {
    const { library, deps, planFor } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      downloadPlan(deps, await planFor("s1"), "p", {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(await library.list()).toEqual([]);
    expect(await readdir(paths.modsStoreDir).catch(() => [])).toEqual([]);
  });

  it("refuses a plan with a missing required dependency", async () => {
    const { deps, planFor } = setup();
    const plan = { ...(await planFor("s1")), missing: [{ projectId: "x" }] };
    await expect(downloadPlan(deps, plan, "p")).rejects.toMatchObject({
      code: "MOD_DEPENDENCY_MISSING",
    });
  });
});

describe("identifying hand-added mods", () => {
  it("fills in the source of jars the site knows, and marks the rest as checked", async () => {
    const { source, library } = setup();
    const unknownJar = fabricMod("private-mod", "1");
    const downloads = join(dir, "dl");
    await mkdir(downloads);
    await writeFile(join(downloads, "sodium.jar"), sodiumJar);
    await writeFile(join(downloads, "private.jar"), unknownJar);
    await library.add([
      join(downloads, "sodium.jar"),
      join(downloads, "private.jar"),
    ]);

    const pending = await library.pendingIdentification();
    expect(pending).toHaveLength(2);
    const found = await source.identifyFiles(pending);
    await library.recordIdentification(
      pending,
      new Map(
        [...found].map(([hash, v]) => [
          hash,
          {
            sourceId: v.sourceId,
            projectId: v.projectId,
            versionId: v.versionId,
            pageUrl: source.pageUrl(v.projectId),
          },
        ]),
      ),
    );

    const list = await library.list();
    expect(list.find((m) => m.modId === "sodium")?.source?.projectId).toBe(
      "sodium",
    );
    expect(list.find((m) => m.modId === "private-mod")).toMatchObject({
      checked: true,
    });
    expect(list.find((m) => m.modId === "private-mod")?.source).toBeUndefined();
    expect(await library.pendingIdentification()).toEqual([]);
  });

  it("asks again about unmatched mods after a week", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const library = createModLibrary({ paths, now: () => now });
    const downloads = join(dir, "dl");
    await mkdir(downloads);
    await writeFile(join(downloads, "x.jar"), fabricMod("x", "1"));
    const [x] = await library.add([join(downloads, "x.jar")]);
    await library.recordIdentification([x!.sha1], new Map());
    expect(await library.pendingIdentification()).toEqual([]);
    now = new Date("2026-01-09T00:00:00Z");
    expect(await library.pendingIdentification()).toEqual([x!.sha1]);
  });
});
