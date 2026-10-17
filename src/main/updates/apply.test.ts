import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BuildInfo } from "./buildKind";
import {
  canReplace,
  cleanupAfterUpdate,
  downloadPath,
  finishUpdate,
  installUpdate,
  prepareUpdate,
  type ApplyDeps,
} from "./apply";
import { readUpdateFlags } from "./startupFlags";

let dir: string;
let spawned: [string, string[]][];
let deps: ApplyDeps;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-apply-"));
  spawned = [];
  deps = {
    spawnDetached: (cmd, args) => spawned.push([cmd, args]),
    pid: 4242,
    tempDir: join(dir, "temp"),
    exeName: "EZLauncher.exe",
  };
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const file = { name: "EZ-0.3.0.zip", url: "u", size: 1, sha256: "a" };
const text = (path: string) => readFile(path, "utf8");

describe("portable exe", () => {
  it("swaps the exe under the same name and starts it", async () => {
    const target = join(dir, "EZLauncher 0.2.0.exe");
    const build: BuildInfo = { kind: "portableExe", target };
    await writeFile(target, "old");
    const download = downloadPath(build, file, deps.tempDir);
    expect(download).toBe(`${target}.update`);
    await writeFile(download, "new");

    expect(await canReplace(build)).toBe(true);
    // The running exe is held open, so the new one is started to finish the job.
    await installUpdate(build, download, true, deps);
    expect(await text(target)).toBe("old");
    const [cmd, args] = spawned[0]!;
    expect(cmd).toBe(download);
    const flags = readUpdateFlags(args);
    expect(flags).toEqual({
      finishTarget: target,
      finishSource: download,
      waitPid: 4242,
      restart: true,
      failed: false,
    });

    spawned = [];
    const ok = await finishUpdate({
      target: flags.finishTarget!,
      source: flags.finishSource!,
      restart: true,
      deps: { ...deps, pid: 99 },
    });
    expect(ok).toBe(true);
    expect(await text(target)).toBe("new");
    expect(spawned).toEqual([[target, ["--ezl-updated=99"]]]);

    await cleanupAfterUpdate(build, deps.tempDir, undefined, 0);
    expect(await readdir(dir)).toEqual(["EZLauncher 0.2.0.exe"]);
  });

  it("keeps the old exe when the new one can't be copied in", async () => {
    const target = join(dir, "EZ.exe");
    await writeFile(target, "old");
    await writeFile(`${target}.update`, "new");
    const ok = await finishUpdate({
      target,
      source: `${target}.update`,
      restart: true,
      deps,
      copy: () => Promise.reject(new Error("disk full")),
    });
    expect(ok).toBe(false);
    expect(await text(target)).toBe("old");
    expect(spawned).toEqual([[target, ["--ezl-update-failed"]]]);
  });

  it("refuses to start a download that isn't there", async () => {
    const target = join(dir, "EZ.exe");
    await writeFile(target, "old");
    await expect(
      installUpdate(
        { kind: "portableExe", target },
        join(dir, "missing.update"),
        true,
        deps,
      ),
    ).rejects.toThrow();
    expect(await text(target)).toBe("old");
    expect(spawned).toEqual([]);
  });
});

describe("zip build", () => {
  const appDir = () => join(dir, "EZLauncher");

  async function setUp(zip: Record<string, Uint8Array>) {
    await mkdir(appDir());
    await writeFile(join(appDir(), "EZLauncher.exe"), "old");
    await writeFile(join(appDir(), "only-old.txt"), "x");
    const build: BuildInfo = { kind: "portableZip", target: appDir() };
    const download = downloadPath(build, file, deps.tempDir);
    await mkdir(deps.tempDir, { recursive: true });
    await writeFile(download, zipSync(zip));
    return { build, download };
  }

  it("unpacks next to the app, then swaps the folders and starts the new one", async () => {
    const enc = new TextEncoder();
    const { build, download } = await setUp({
      "EZLauncher.exe": enc.encode("new"),
      "resources/app.asar": enc.encode("asar"),
    });
    await prepareUpdate(build, download, deps);
    expect(await text(join(`${appDir()}.new`, "resources", "app.asar"))).toBe(
      "asar",
    );

    await installUpdate(build, download, false, deps);
    const [cmd, args] = spawned[0]!;
    expect(cmd).toBe(join(`${appDir()}.new`, "EZLauncher.exe"));
    const flags = readUpdateFlags(args);
    expect(flags).toEqual({
      finishTarget: appDir(),
      waitPid: 4242,
      restart: false,
      failed: false,
    });

    // The new version, started from `.new`, finishes the swap.
    spawned = [];
    const ok = await finishUpdate({
      target: flags.finishTarget!,
      restart: true,
      deps: { ...deps, pid: 99 },
    });
    expect(ok).toBe(true);
    expect(await text(join(appDir(), "EZLauncher.exe"))).toBe("new");
    expect(await readdir(appDir())).not.toContain("only-old.txt");
    expect(spawned).toEqual([
      [join(appDir(), "EZLauncher.exe"), ["--ezl-updated=99"]],
    ]);

    await cleanupAfterUpdate(build, deps.tempDir, undefined, 0);
    expect(await readdir(dir)).toEqual(["EZLauncher"]);
  });

  it("finds the app in a zip with one top folder", async () => {
    const { build, download } = await setUp({
      "EZLauncher-0.3.0/EZLauncher.exe": new TextEncoder().encode("new"),
    });
    await prepareUpdate(build, download, deps);
    expect(await text(join(`${appDir()}.new`, "EZLauncher.exe"))).toBe("new");
  });

  it("refuses a zip without the app or with unsafe paths", async () => {
    const a = await setUp({ "readme.txt": new Uint8Array(1) });
    await expect(
      prepareUpdate(a.build, a.download, deps),
    ).rejects.toMatchObject({ code: "UPDATE_DAMAGED" });
    await rm(appDir(), { recursive: true });
    const b = await setUp({ "../evil.exe": new Uint8Array(1) });
    await expect(
      prepareUpdate(b.build, b.download, deps),
    ).rejects.toMatchObject({ code: "UPDATE_DAMAGED" });
    expect(await readdir(dir)).not.toContain("evil.exe");
  });

  it("puts the old version back when the copy fails", async () => {
    await mkdir(appDir());
    await writeFile(join(appDir(), "EZLauncher.exe"), "old");
    await mkdir(`${appDir()}.new`);
    const ok = await finishUpdate({
      target: appDir(),
      restart: true,
      deps,
      copy: async (_from: string, to: string) => {
        await mkdir(to);
        await writeFile(join(to, "half"), "");
        throw new Error("disk full");
      },
    });
    expect(ok).toBe(false);
    expect(await readdir(appDir())).toEqual(["EZLauncher.exe"]);
    expect(await text(join(appDir(), "EZLauncher.exe"))).toBe("old");
    expect(spawned).toEqual([
      [join(appDir(), "EZLauncher.exe"), ["--ezl-update-failed"]],
    ]);
  });
});

describe("installer", () => {
  it("runs the setup silently", async () => {
    const build: BuildInfo = { kind: "installer", target: "C:\\EZ\\EZ.exe" };
    const download = downloadPath(build, file, deps.tempDir);
    await installUpdate(build, download, true, deps);
    expect(spawned).toEqual([[download, ["/S", "--updated", "--force-run"]]]);
  });
});

describe("readUpdateFlags", () => {
  it("ignores what isn't a flag of ours", () => {
    expect(
      readUpdateFlags(["app.exe", "--ezl-updated=abc", "--ezl-profile=x"]),
    ).toEqual({ restart: true, failed: false });
  });
});
