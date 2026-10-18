import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDownloader } from "../minecraft/downloader";
import { createPaths, type Paths } from "../minecraft/paths";
import { createFakeFetch, sha1 } from "../minecraft/testing/fakeFetch";
import { createModLibrary } from "../profiles/mods";
import { fabricMod } from "../profiles/testing/modJars";
import { downloadPlan } from "./downloadMods";
import {
  applyModUpdates,
  findModUpdates,
  looksLikeRelease,
} from "./modUpdates";
import { resolveInstall } from "./resolveDependencies";
import { createFakeModSource } from "./testing/fakeModSource";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-modupdates-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const profile = { id: "p", gameVersion: "1.18.2", loader: { id: "fabric" } };
const target = { gameVersion: "1.18.2", loaders: ["fabric"] };

const sodiumOld = fabricMod("sodium", "0.4.1");
const sodiumNew = fabricMod("sodium", "0.5.0");
const sodiumBeta = fabricMod("sodium", "0.6.0-beta.1");
const indium = fabricMod("indium", "1.0.0");
// A jar with no mod id (no metadata the library can read an id from).
const plainOld = zipSync({ "META-INF/MANIFEST.MF": strToU8("old") });
const plainNew = zipSync({ "META-INF/MANIFEST.MF": strToU8("new") });

function setup() {
  const jars = {
    "https://fake/sodium-old.jar": sodiumOld,
    "https://fake/sodium-new.jar": sodiumNew,
    "https://fake/sodium-beta.jar": sodiumBeta,
    "https://fake/indium.jar": indium,
    "https://fake/plain-old.jar": plainOld,
    "https://fake/plain-new.jar": plainNew,
  };
  const files = createFakeFetch(jars);
  const v = (
    projectId: string,
    versionId: string,
    jar: Uint8Array,
    url: string,
    extra: object = {},
  ) => ({
    projectId,
    versionId,
    versionNumber: versionId,
    sha1: sha1(jar),
    size: jar.length,
    url,
    fileName: `${projectId}-${versionId}.jar`,
    ...extra,
  });
  // Newest first.
  const source = createFakeModSource(
    [
      { projectId: "sodium", name: "Sodium" },
      { projectId: "indium", name: "Indium" },
      { projectId: "plain", name: "Plain" },
    ],
    [
      v("sodium", "0.6.0-beta.1", sodiumBeta, "https://fake/sodium-beta.jar", {
        channel: "beta",
      }),
      v("sodium", "0.5.0", sodiumNew, "https://fake/sodium-new.jar", {
        dependencies: [{ projectId: "indium", kind: "required" }],
        changelog: "- Faster",
        published: "2026-10-01T00:00:00Z",
      }),
      v("sodium", "0.4.1", sodiumOld, "https://fake/sodium-old.jar"),
      v("indium", "1.0.0", indium, "https://fake/indium.jar"),
      v("plain", "2", plainNew, "https://fake/plain-new.jar"),
      v("plain", "1", plainOld, "https://fake/plain-old.jar"),
    ],
  );
  const downloader = createDownloader({
    fetch: files.fetch,
    userAgent: "t",
    retries: 0,
  });
  const library = createModLibrary({ paths });
  const sources = { get: () => source };
  const install = async (versionId: string) => {
    const plan = await resolveInstall(
      source,
      await source.getVersion(versionId),
      { gameVersion: "", loaders: ["fabric"] },
      await library.view(profile),
    );
    // Install exactly the old version, not what the resolver would pick.
    await downloadPlan({ downloader, paths, library, source }, plan, "p");
  };
  return { source, library, downloader, sources, install, files };
}

describe("findModUpdates", () => {
  it("offers the newest release, with its changelog, and counts the rest", async () => {
    const { library, sources, install } = setup();
    await install("0.4.1");
    await install("2");
    const { check, versions } = await findModUpdates({
      sources,
      enabled: await library.enabledMods("p"),
      target,
      packFiles: new Set([sha1(sodiumOld)]),
    });
    // Sodium: a beta is newer, but a release stays on releases.
    expect(check.updates).toEqual([
      expect.objectContaining({
        name: "sodium mod",
        fromVersion: "0.4.1",
        toVersion: "0.5.0",
        channel: "release",
        changelog: "- Faster",
        fromPack: true,
        pageUrl: "https://fake/mod/sodium",
      }),
    ]);
    // Plain is already the newest.
    expect(check.upToDate).toBe(1);
    expect(versions.get(sha1(sodiumOld))?.versionId).toBe("0.5.0");
  });

  it("can't check mods no site knows", async () => {
    const { sources } = setup();
    const { check } = await findModUpdates({
      sources,
      enabled: [
        {
          sha1: "x".repeat(40),
          meta: { name: "Hand-made" } as never,
        },
      ],
      target,
    });
    expect(check.unknown).toEqual([{ name: "Hand-made" }]);
  });

  it("knows which versions look like pre-releases", () => {
    expect(looksLikeRelease("0.5.0")).toBe(true);
    expect(looksLikeRelease("0.6.0-beta.1")).toBe(false);
    expect(looksLikeRelease("2.0-rc1")).toBe(false);
  });
});

describe("applyModUpdates", () => {
  it("updates, adds a new required mod, and keeps the old jar for going back", async () => {
    const { library, sources, downloader, install } = setup();
    await install("0.4.1");
    const { versions } = await findModUpdates({
      sources,
      enabled: await library.enabledMods("p"),
      target,
    });
    const enabled = await library.enabledMods("p");
    const result = await applyModUpdates(
      { downloader, paths, library, sources },
      {
        profile,
        target,
        picks: enabled.flatMap((old) => {
          const version = versions.get(old.sha1);
          return version ? [{ old, version }] : [];
        }),
      },
    );
    expect(result).toEqual({
      updated: [{ name: "sodium mod", from: "0.4.1", to: "0.5.0" }],
      failed: [],
    });
    const now = await library.enabledMods("p");
    expect(now.map((m) => m.meta.version).sort()).toEqual(["0.5.0", "1.0.0"]);
    // Indium came in as a dependency; the old Sodium is still in the library.
    const all = await library.list(profile);
    expect(all.find((m) => m.modId === "indium")?.dependency).toBe(true);
    expect(all.some((m) => m.version === "0.4.1" && !m.enabled)).toBe(true);
    expect((await readdir(paths.modsDir("p"))).sort()).toEqual([
      "indium-1.0.0.jar",
      "sodium-0.5.0.jar",
    ]);
  });

  it("unlinks the old jar of a mod without a mod id", async () => {
    const { library, sources, downloader, install } = setup();
    await install("1");
    const [old] = await library.enabledMods("p");
    expect(old?.meta.modId).toBeUndefined();
    const { versions } = await findModUpdates({
      sources,
      enabled: [old!],
      target,
    });
    await applyModUpdates(
      { downloader, paths, library, sources },
      {
        profile,
        target,
        picks: [{ old: old!, version: versions.get(old!.sha1)! }],
      },
    );
    expect((await library.enabledMods("p")).map((m) => m.sha1)).toEqual([
      sha1(plainNew),
    ]);
  });

  it("reports an update whose required mod has no version, and changes nothing", async () => {
    const { library, sources, downloader, install, source } = setup();
    await install("0.4.1");
    const [old] = await library.enabledMods("p");
    const version = await source.getVersion("0.5.0");
    const result = await applyModUpdates(
      { downloader, paths, library, sources },
      {
        profile,
        target,
        picks: [
          {
            old: old!,
            version: {
              ...version,
              dependencies: [{ projectId: "gone", kind: "required" }],
            },
          },
        ],
      },
    );
    expect(result.failed).toEqual([
      { name: "sodium mod", code: "MOD_DEPENDENCY_MISSING" },
    ]);
    expect((await library.enabledMods("p")).map((m) => m.meta.version)).toEqual(
      ["0.4.1"],
    );
  });
});
