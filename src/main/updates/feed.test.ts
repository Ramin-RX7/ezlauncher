import { describe, expect, it } from "vitest";
import { parseFeed, pickUpdate, REPO_URL } from "./feed";

const file = (
  name: string,
  url = `${REPO_URL}/releases/download/v/${name}`,
) => ({
  name,
  url,
  size: 100,
  sha256: "a".repeat(64),
});

const feedText = JSON.stringify({
  schema: 1,
  releases: [
    {
      version: "0.4.0-beta.1",
      date: "2026-12-01",
      prerelease: true,
      notes: "- Beta",
      files: { winPortableExe: file("beta.exe") },
    },
    {
      version: "0.3.1",
      date: "2026-11-01",
      prerelease: false,
      notes: "- Fix",
      files: {
        winPortableExe: file("p.exe"),
        winSetup: file("s.exe", "https://evil.example/s.exe"),
        winPortableZip: { name: "broken" },
        futureKind: file("x"),
      },
      extra: "ignored",
    },
    { version: "not a version", date: "", files: {} },
    {
      version: "0.3.0",
      date: "2026-10-20",
      notes: "- New",
      files: { winPortableExe: file("old.exe") },
    },
    { version: "0.2.0", date: "2026-10-02", notes: "- Old", files: {} },
  ],
});

describe("parseFeed", () => {
  it("keeps what parses and drops the rest", () => {
    const feed = parseFeed(feedText);
    expect(feed.releases.map((r) => r.version)).toEqual([
      "0.4.0-beta.1",
      "0.3.1",
      "0.3.0",
      "0.2.0",
    ]);
    expect(Object.keys(feed.releases[1]!.files).sort()).toEqual([
      "winPortableExe",
      "winSetup",
    ]);
  });

  it("refuses what isn't a feed", () => {
    expect(() => parseFeed("{}")).toThrow();
    expect(() => parseFeed("<html>")).toThrow();
  });
});

describe("pickUpdate", () => {
  const feed = parseFeed(feedText);

  it("offers the newest stable release with every newer release's notes", () => {
    const picked = pickUpdate(feed, "0.2.0", "portableExe");
    expect(picked?.file?.name).toBe("p.exe");
    expect(picked?.update).toEqual({
      version: "0.3.1",
      date: "2026-11-01",
      size: 100,
      pageUrl: `${REPO_URL}/releases/tag/v0.3.1`,
      notes: [
        { version: "0.3.1", date: "2026-11-01", notes: "- Fix" },
        { version: "0.3.0", date: "2026-10-20", notes: "- New" },
      ],
    });
  });

  it("offers nothing when this is the newest", () => {
    expect(pickUpdate(feed, "0.3.1", "portableExe")).toBeUndefined();
    expect(pickUpdate(feed, "0.5.0", "portableExe")).toBeUndefined();
  });

  it("only links to the release page when this build can't update itself", () => {
    expect(pickUpdate(feed, "0.2.0", "portableZip")?.update.blocked).toBe(
      "noFile",
    );
    // A download from anywhere but the repo's releases is never used.
    const setup = pickUpdate(feed, "0.2.0", "installer");
    expect(setup?.file).toBeUndefined();
    expect(setup?.update.blocked).toBe("noFile");
    expect(pickUpdate(feed, "0.2.0", "other")?.update.blocked).toBe(
      "unsupported",
    );
    expect(pickUpdate(feed, "0.2.0", "dev")?.update.blocked).toBe("dev");
    expect(
      pickUpdate(feed, "0.2.0", "installer", { allowAnyUrl: true })?.file?.url,
    ).toBe("https://evil.example/s.exe");
  });
});
