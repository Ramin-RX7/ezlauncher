import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Downloader } from "./downloader";
import { createPaths, type Paths } from "./paths";
import { createPatchNotes, PATCH_NOTES_INDEX_URL } from "./patchNotes";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-notes-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const entry = (
  version: string,
  contentPath = `javaPatchNotes/${version}.json`,
) => ({
  id: version.replace(/\./g, "-"),
  version,
  title: `Minecraft ${version}`,
  type: "release",
  date: "2026-01-01T00:00:00.000Z",
  contentPath,
});

/** A fake site: URL → body; counts requests. */
function site(files: Record<string, unknown>) {
  const calls: string[] = [];
  let online = true;
  const downloader = {
    fetchText(url: string) {
      calls.push(url);
      if (!online) return Promise.reject(new Error("offline"));
      const body = files[url];
      return body === undefined
        ? Promise.reject(new Error(`404 ${url}`))
        : Promise.resolve(JSON.stringify(body));
    },
  } as unknown as Downloader;
  return {
    downloader,
    calls,
    goOffline: () => {
      online = false;
    },
  };
}

const notes = (version: string) => ({
  title: `Minecraft ${version}`,
  version,
  type: "release",
  date: "2026-01-01T00:00:00.000Z",
  body: "<p>Hello<h1>Changes</h1>",
  image: { url: "/x.jpg" },
});

describe("patch notes", () => {
  it("finds a version in the index and saves its entry", async () => {
    const s = site({
      [PATCH_NOTES_INDEX_URL]: { version: 1, entries: [entry("1.21.4")] },
      "https://launchercontent.mojang.com/v2/javaPatchNotes/1.21.4.json":
        notes("1.21.4"),
    });
    const pn = createPatchNotes({ paths, downloader: s.downloader });
    expect(await pn.get("1.21.4")).toEqual({
      title: "Minecraft 1.21.4",
      version: "1.21.4",
      type: "release",
      date: "2026-01-01T00:00:00.000Z",
      body: "<p>Hello<h1>Changes</h1>",
    });
    // Saved: works again offline.
    s.goOffline();
    expect((await pn.get("1.21.4"))?.title).toBe("Minecraft 1.21.4");
  });

  it("returns null for versions Mojang has no notes for, without asking again right away", async () => {
    const s = site({
      [PATCH_NOTES_INDEX_URL]: { version: 1, entries: [entry("1.21.4")] },
    });
    const pn = createPatchNotes({ paths, downloader: s.downloader });
    expect(await pn.get("1.8.9")).toBeNull();
    expect(await pn.get("1.8.9")).toBeNull();
    expect(s.calls.filter((u) => u === PATCH_NOTES_INDEX_URL)).toHaveLength(1);
  });

  it("refuses entry paths that leave the feed", async () => {
    const s = site({
      [PATCH_NOTES_INDEX_URL]: {
        version: 1,
        entries: [entry("1.21.4", "../evil.json")],
      },
    });
    const pn = createPatchNotes({ paths, downloader: s.downloader });
    await expect(pn.get("1.21.4")).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });
});
