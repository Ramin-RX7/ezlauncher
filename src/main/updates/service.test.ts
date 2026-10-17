import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UpdateState } from "@shared/updates";
import { createFakeFetch } from "../minecraft/testing/fakeFetch";
import { CHECK_EVERY_MS, createUpdateService } from "./service";

const FEED = "https://feed.test/releases.json";
const EXE_URL = "https://files.test/EZ-0.3.0-portable.exe";
const exe = new TextEncoder().encode("new exe");

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-updsvc-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function feed(version = "0.3.0") {
  return JSON.stringify({
    schema: 1,
    releases: [
      {
        version,
        date: "2026-10-20",
        notes: "- New",
        files: {
          winPortableExe: {
            name: "EZ.exe",
            url: EXE_URL,
            size: exe.length,
            sha256: createHash("sha256").update(exe).digest("hex"),
          },
        },
      },
    ],
  });
}

function setUp(opts: { busy?: boolean; now?: number } = {}) {
  const fake = createFakeFetch({ [FEED]: feed(), [EXE_URL]: exe });
  const states: UpdateState[] = [];
  const spawned: string[][] = [];
  const target = join(dir, "EZLauncher.exe");
  let clock = opts.now ?? Date.parse("2026-10-21T12:00:00Z");
  const service = createUpdateService({
    fetch: fake.fetch,
    version: "0.2.0",
    build: { kind: "portableExe", target },
    stateFile: join(dir, "updates.json"),
    userAgent: "test",
    feedUrl: FEED,
    isBusy: () => opts.busy ?? false,
    onState: (s) => states.push(s),
    now: () => clock,
    apply: {
      spawnDetached: (cmd, args) => spawned.push([cmd, ...args]),
      pid: 7,
      tempDir: join(dir, "temp"),
      exeName: "EZLauncher.exe",
    },
  });
  return {
    fake,
    states,
    spawned,
    target,
    service,
    advance: (ms: number) => (clock += ms),
  };
}

describe("update service", () => {
  it("checks, downloads and installs an update", async () => {
    const { service, target, spawned } = setUp();
    await writeFile(target, "old exe");
    const checked = await service.check({ manual: true });
    expect(checked).toMatchObject({
      status: "available",
      update: { version: "0.3.0", size: exe.length },
    });
    expect(
      (checked as { update: { blocked?: string } }).update.blocked,
    ).toBeUndefined();

    await service.download();
    expect(service.getState().status).toBe("ready");
    await service.install({ restart: true });
    // The verified download is started to put itself in place.
    expect(await readFile(`${target}.update`, "utf8")).toBe("new exe");
    expect(spawned).toEqual([
      [
        `${target}.update`,
        `--ezl-update-finish=${target}`,
        `--ezl-update-from=${target}.update`,
        "--ezl-updated=7",
      ],
    ]);
  });

  it("says when this is the newest version", async () => {
    const { service, fake } = setUp();
    fake.routes[FEED] = feed("0.2.0");
    expect(await service.check({ manual: true })).toMatchObject({
      status: "upToDate",
    });
  });

  it("reports a failed check only when asked by hand", async () => {
    const { service, fake } = setUp();
    fake.setOffline(true);
    expect((await service.check({ manual: false })).status).toBe("idle");
    expect(await service.check({ manual: true })).toMatchObject({
      status: "error",
      code: "OFFLINE",
    });
  });

  it("refuses to install while the launcher is busy", async () => {
    const { service, target, spawned } = setUp({ busy: true });
    await writeFile(target, "old exe");
    await service.check({ manual: true });
    await service.download();
    await expect(service.install({ restart: true })).rejects.toMatchObject({
      code: "UPDATE_BUSY",
    });
    await service.installOnQuit();
    expect(spawned).toEqual([]);
  });

  it("checks once a day, and not at all when turned off", async () => {
    const { service, fake, advance } = setUp();
    await service.check({ manual: false });
    const requests = () => fake.requests.filter((u) => u === FEED).length;
    expect(requests()).toBe(1);

    // checkIfDue runs through setPrefs (and the timers).
    await service.setPrefs({ autoCheck: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(requests()).toBe(1);

    advance(CHECK_EVERY_MS + 1);
    await service.setPrefs({ autoCheck: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(requests()).toBe(2);

    advance(CHECK_EVERY_MS + 1);
    await service.setPrefs({ autoCheck: false });
    await new Promise((r) => setTimeout(r, 20));
    expect(requests()).toBe(2);
    expect(await service.getPrefs()).toEqual({ autoCheck: false });
  });
});
