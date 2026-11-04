import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BackupStateEvent,
  LauncherSettings,
  Profile,
} from "@shared/launcher";
import { createLogger } from "../core/logger";
import { createPaths, type Paths } from "../minecraft/paths";
import { syncWorlds, WORLD_FLAG } from "../profiles/worlds";
import { createBackupService } from "./backups";
import { createRuntime } from "./runtime";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-backups-svc-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const logger = createLogger({ console: false });

/** A world owned by `p1`, linked into its `saves/`. */
async function world(id = "Survival") {
  const w = paths.worldDir(id);
  await mkdir(w, { recursive: true });
  await writeFile(join(w, "level.dat"), "level");
  await writeFile(join(w, WORLD_FLAG), '{"schema":1,"profileId":"p1"}');
  await syncWorlds(
    { paths, logger },
    { profileIds: ["p1"], isRunning: () => false },
  );
}

function setup(settings: Partial<LauncherSettings> = {}) {
  const runtime = createRuntime();
  const states: BackupStateEvent[] = [];
  const changed = vi.fn();
  const service = createBackupService({
    paths,
    settings: {
      load: () =>
        Promise.resolve({
          backupAuto: "off",
          backupWhen: "afterExit",
          backupKeepCount: 10,
          backupKeepDays: 30,
          ...settings,
        } as LauncherSettings),
    },
    runtime,
    whenReady: () => Promise.resolve(),
    requireProfile: (id) => Promise.resolve({ id } as Profile),
    sync: () => Promise.resolve(),
    changed,
    openFolder: () => Promise.resolve(),
    showItemInFolder: () => undefined,
    state: (e) => states.push(e),
    progress: () => undefined,
    logger,
  });
  return { service, runtime, states, changed };
}

describe("createBackupService", () => {
  it("backs up a profile's worlds, then skips them while unchanged", async () => {
    await world();
    const { service, states } = setup();

    const first = await service.api.backupWorlds("p1");
    expect(first).toEqual({ created: ["Survival"], unchanged: [], failed: [] });
    expect(states.map((s) => s.status)).toEqual(["running", "done"]);
    expect(service.isBusy()).toBe(false);

    const again = await service.api.backupWorlds("p1");
    expect(again.unchanged).toEqual(["Survival"]);
    expect(await service.api.listWorldBackups("p1", "Survival")).toHaveLength(
      1,
    );
    const [info] = await service.worldsWithBackups("p1");
    expect(info).toMatchObject({ id: "Survival", backupCount: 1 });
  });

  it("refuses a manual backup while the profile plays or the data folder moves", async () => {
    await world();
    const { service, runtime } = setup();
    runtime.starting.add("p1:a1");
    await expect(service.api.backupWorlds("p1")).rejects.toMatchObject({
      code: "GAME_RUNNING",
    });
    runtime.starting.clear();
    runtime.moving = true;
    await expect(service.api.backupWorlds("p1")).rejects.toMatchObject({
      code: "BUSY",
    });
  });

  it("backs up automatically only at the moment the settings name", async () => {
    await world();
    const off = setup();
    expect(await off.service.autoBackup("p1", "afterExit")).toBeUndefined();

    const { service } = setup({
      backupAuto: "launch",
      backupWhen: "beforeStart",
    });
    expect(await service.autoBackup("p1", "afterExit")).toBeUndefined();
    const made = await service.autoBackup("p1", "beforeStart");
    expect(made?.created).toEqual(["Survival"]);
  });

  it("counts and deletes backups of worlds that are gone", async () => {
    await world();
    const { service } = setup();
    await service.api.backupWorlds("p1");
    expect(await service.isOrphanBackup("Survival")).toBe(false);
    expect(await service.isOrphanBackup("Gone")).toBe(true);

    await rm(paths.worldDir("Survival"), { recursive: true });
    expect((await service.api.backupSummary()).orphans).toMatchObject({
      worlds: 1,
      count: 1,
    });
    expect(await service.api.deleteOrphanBackups()).toBe(1);
    expect((await service.api.backupSummary()).count).toBe(0);
  });
});
