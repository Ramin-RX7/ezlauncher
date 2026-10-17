import { describe, expect, it } from "vitest";
import { addRelease, parseSums, readFeed, writeFeed } from "./feed.mjs";

const REPO = "https://github.com/o/r";
const hash = (c: string) => c.repeat(64);

const input = (version: string) => ({
  version,
  date: "2026-10-20",
  notes: "### Added\n\n- A thing\n",
  repoUrl: REPO,
  assets: [
    { name: `EZLauncher-${version}-x64-setup.exe`, size: 10 },
    { name: `EZLauncher-${version}-x64-portable.exe`, size: 11 },
    { name: `EZLauncher-${version}-x64-portable.zip`, size: 12 },
    { name: `EZLauncher-${version}-x86_64.AppImage`, size: 13 },
    { name: "SHA256SUMS.txt", size: 1 },
  ],
  sums: [
    `${hash("a")}  EZLauncher-${version}-x64-setup.exe`,
    `${hash("B")} *EZLauncher-${version}-x64-portable.exe`,
    `${hash("c")}  EZLauncher-${version}-x64-portable.zip`,
    `${hash("d")}  EZLauncher-${version}-x86_64.AppImage`,
  ].join("\r\n"),
});

describe("parseSums", () => {
  it("reads text and binary mode lines", () => {
    expect(
      parseSums(`${hash("A")}  a.exe\n${hash("b")} *b.zip\nnoise\n`),
    ).toEqual(
      new Map([
        ["a.exe", hash("a")],
        ["b.zip", hash("b")],
      ]),
    );
  });
});

describe("addRelease", () => {
  it("matches each file to its build", () => {
    const feed = addRelease(undefined, input("0.3.0"));
    const [release] = feed.releases;
    expect(release).toMatchObject({
      version: "0.3.0",
      date: "2026-10-20",
      prerelease: false,
      notes: "### Added\n\n- A thing",
    });
    expect(release?.files.winPortableExe).toEqual({
      name: "EZLauncher-0.3.0-x64-portable.exe",
      url: `${REPO}/releases/download/v0.3.0/EZLauncher-0.3.0-x64-portable.exe`,
      size: 11,
      sha256: hash("b"),
    });
    expect(Object.keys(release?.files ?? {}).sort()).toEqual([
      "linuxAppImage",
      "winPortableExe",
      "winPortableZip",
      "winSetup",
    ]);
  });

  it("keeps the newest first and replaces a re-published version", () => {
    let feed = addRelease(undefined, input("0.3.0"));
    feed = addRelease(feed, input("0.2.1"));
    feed = addRelease(feed, { ...input("0.3.0"), notes: "- Fixed" });
    expect(feed.releases.map((r) => r.version)).toEqual(["0.3.0", "0.2.1"]);
    expect(feed.releases[0]?.notes).toBe("- Fixed");
    expect(readFeed(writeFeed(feed))).toEqual(feed);
  });

  it("marks pre-releases", () => {
    expect(
      addRelease(undefined, input("0.3.0-beta.1")).releases[0]?.prerelease,
    ).toBe(true);
  });

  it("refuses a file without a checksum, or a release without files", () => {
    const i = input("0.3.0");
    expect(() =>
      addRelease(undefined, { ...i, sums: i.sums.split("\r\n")[0] ?? "" }),
    ).toThrow(/no line for/);
    expect(() =>
      addRelease(undefined, { ...i, assets: [{ name: "x.txt", size: 1 }] }),
    ).toThrow(/none of the app's files/);
  });
});
