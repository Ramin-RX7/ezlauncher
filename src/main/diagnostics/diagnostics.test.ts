import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatDiagnostics, MAX_DIAGNOSTICS_CHARS } from "./diagnostics";
import { newestFile, readHead, readTail } from "./logTail";
import { redact } from "./redact";

describe("redact", () => {
  const secrets = {
    dataDir: "D:\\games\\.ezlauncher2",
    homeDir: "C:\\Users\\Ramin",
    userName: "Ramin",
    playerNames: ["Steve", "Al"],
    uuids: ["8667ba71-b85a-4004-af54-457a9734eed7"],
  };

  it("hides paths in either slash style, names, UUIDs and tokens", () => {
    const text = [
      "loading D:\\games\\.ezlauncher2\\profiles\\p1\\mods",
      "java at c:/users/ramin/AppData/java.exe",
      "Setting user: Steve",
      "UUID of player Steve is 8667ba71b85a4004af54457a9734eed7",
      "user ramin logged in; Steven stays",
      "--accessToken abc123def456 --version 1.21",
      "auth_access_token=abcdefghijkl",
      "Alpha and Al",
    ].join("\n");
    expect(redact(text, secrets)).toBe(
      [
        "loading <data>\\profiles\\p1\\mods",
        "java at ~/AppData/java.exe",
        "Setting user: <player>",
        "UUID of player <player> is <uuid>",
        "user <user> logged in; Steven stays",
        "--accessToken <hidden> --version 1.21",
        "auth_access_token=<hidden>",
        "Alpha and <player>",
      ].join("\n"),
    );
  });

  it("hides the data folder before the home folder it is inside", () => {
    expect(
      redact("/home/me/.ezlauncher/logs", {
        homeDir: "/home/me",
        dataDir: "/home/me/.ezlauncher",
      }),
    ).toBe("<data>/logs");
  });
});

describe("formatDiagnostics", () => {
  const base = {
    createdAt: "2026-10-17T10:00:00.000Z",
    app: {
      version: "0.3.0",
      build: "portableZip",
      electron: "44.4.5",
      os: "Windows_NT 10.0.26200",
      arch: "x64",
      totalMemoryMb: 16000,
    },
    secrets: { homeDir: "C:\\Users\\Ramin", playerNames: ["Steve"] },
  };

  it("works without a data folder", () => {
    const text = formatDiagnostics(base);
    expect(text).toContain("- Version: 0.3.0 (portableZip)");
    expect(text).not.toContain("## Profile");
  });

  it("lists the profile, its mods and logs, redacted", () => {
    const text = formatDiagnostics({
      ...base,
      profile: {
        name: "Steve's world",
        gameVersion: "1.21.4",
        loader: "fabric",
        loaderBuild: "0.16.9",
        running: false,
        mods: [
          {
            name: "Sodium",
            version: "0.6.0",
            modId: "sodium",
            fromModrinth: true,
          },
          { name: "Mine", fromModrinth: false },
        ],
        issues: ["error mcVersion (Mine)"],
        latestLog: "[main/INFO]: Setting user: Steve\nC:\\Users\\Ramin\\x",
      },
      launcherLog: "INFO launching as Steve",
    });
    expect(text).toContain("- Minecraft 1.21.4, fabric 0.16.9 (pinned)");
    expect(text).toContain("- Sodium 0.6.0 [sodium]");
    expect(text).toContain("- Mine (not from Modrinth)");
    expect(text).toContain("- error mcVersion (Mine)");
    expect(text).toContain("Setting user: <player>\n~\\x");
    expect(text).toContain("launching as <player>");
    expect(text).not.toMatch(/Steve|Ramin/);
  });

  it("is never too long", () => {
    const text = formatDiagnostics({
      ...base,
      launcherLog: "x".repeat(MAX_DIAGNOSTICS_CHARS * 2),
    });
    expect(text.length).toBeLessThan(MAX_DIAGNOSTICS_CHARS + 20);
  });
});

describe("log files", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ezl-diag-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads the end and the start of a file", async () => {
    const file = join(dir, "latest.log");
    await writeFile(
      file,
      Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\r\n") + "\r\n",
    );
    expect(await readTail(file, 3)).toBe("line 997\nline 998\nline 999");
    // Reading only the last 23 bytes drops the cut-off first line ("97").
    expect(await readTail(file, 100, 23)).toBe("line 998\nline 999");
    expect(await readHead(file, 2)).toBe("line 0\nline 1");
    expect(await readTail(join(dir, "missing"), 3)).toBeUndefined();
  });

  it("finds the newest crash report", async () => {
    const reports = join(dir, "crash-reports");
    await mkdir(reports);
    await writeFile(join(reports, "old.txt"), "");
    await writeFile(join(reports, "new.txt"), "");
    await utimes(join(reports, "old.txt"), 1000, 1000);
    expect((await newestFile(reports))?.path).toBe(join(reports, "new.txt"));
    expect(await newestFile(join(dir, "none"))).toBeUndefined();
  });
});
