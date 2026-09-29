import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSettingsStore, DEFAULT_SETTINGS } from "./settings";

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-settings-"));
  file = join(dir, "settings.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("settings store", () => {
  it("starts with automatic backups off and the default retention", async () => {
    expect(await createSettingsStore(file).load()).toMatchObject({
      backupAuto: "off",
      backupWhen: "afterExit",
      backupIntervalDays: 7,
      backupKeepCount: 10,
      backupKeepDays: 30,
    });
  });

  it("keeps a turned-off limit (null) as it is", async () => {
    const store = createSettingsStore(file);
    await store.update({ backupKeepCount: null, backupAuto: "interval" });
    expect(await createSettingsStore(file).load()).toMatchObject({
      backupKeepCount: null,
      backupKeepDays: 30,
      backupAuto: "interval",
    });
  });

  it("refuses out-of-range values and falls back for bad ones on disk", async () => {
    const store = createSettingsStore(file);
    await expect(store.update({ backupKeepDays: 0 })).rejects.toMatchObject({
      code: "INVALID_SETTINGS",
    });
    await writeFile(
      file,
      JSON.stringify({
        schema: 1,
        memoryMaxMb: 2048,
        onGameStart: "keep",
        backupAuto: "sometimes",
        backupKeepCount: -3,
      }),
    );
    expect(await createSettingsStore(file).load()).toMatchObject({
      backupAuto: DEFAULT_SETTINGS.backupAuto,
      backupKeepCount: DEFAULT_SETTINGS.backupKeepCount,
    });
  });
});
