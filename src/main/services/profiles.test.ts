import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { gzipSync } from "fflate";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@shared/launcher";
import { AppError } from "../core/errors";
import { createLogger } from "../core/logger";
import { createPaths, type Paths } from "../minecraft/paths";
import { exists } from "../profiles/linkedStore";
import { TAG, writeNbt, type Compound, type Tag } from "../profiles/nbtTree";
import { createModLibrary } from "../profiles/mods";
import { createPackLibrary, shaderPackKind } from "../profiles/packs/library";
import { createProfilePacks } from "../profiles/packs/profilePacks";
import { createProfileShaders } from "../profiles/packs/profileShaders";
import { createPlayTime } from "../profiles/playTime";
import { createProfileStore } from "../profiles/profiles";
import { fabricMod } from "../profiles/testing/modJars";
import { listWorlds, syncWorlds, WORLD_FLAG } from "../profiles/worlds";
import { createSettingsStore } from "../settings/settings";
import { createProfileService } from "./profiles";
import { createRuntime } from "./runtime";

let dir: string;
let paths: Paths;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-profiles-svc-"));
  paths = createPaths(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

const logger = createLogger({ console: false });

function setup() {
  const runtime = createRuntime();
  const profiles = createProfileStore(paths.launcherFile("profiles.json"));
  const mods = createModLibrary({ paths });
  const packs = createPackLibrary({ paths });
  const shaders = createPackLibrary({ paths, kind: shaderPackKind(paths) });
  const dataPacks = createPackLibrary({ paths });
  const playTime = createPlayTime(paths.launcherFile("playtime.json"));
  const settings = createSettingsStore(paths.launcherFile("settings.json"));
  const modpacks = {
    copyTo: vi.fn(() => Promise.resolve()),
    forgetProfile: vi.fn(() => Promise.resolve()),
  };
  const worldOptions = async () => ({
    profileIds: (await profiles.list()).map((p) => p.id),
    isRunning: runtime.isRunning,
  });
  const requireProfile = async (id: string): Promise<Profile> => {
    const p = await profiles.get(id);
    if (!p) throw new AppError("PROFILE_NOT_FOUND", "gone");
    return p;
  };
  const forgetInLibraries = async (id: string) => {
    await mods.forgetProfile(id);
    await packs.forgetProfile(id);
    await shaders.forgetProfile(id);
  };
  const service = createProfileService({
    paths,
    profiles,
    mods,
    dataPacks,
    profilePacks: createProfilePacks({
      paths,
      library: packs,
      gameFormat: () => Promise.resolve(undefined),
    }),
    profileShaders: createProfileShaders({ paths, library: shaders }),
    modpacks,
    playTime,
    settings,
    runtime,
    whenReady: () => Promise.resolve(),
    requireProfile,
    sync: async (only) => {
      await syncWorlds(
        { paths, logger },
        { ...(await worldOptions()), ...(only && { only }) },
      );
    },
    changed: () => undefined,
    validateLoader: (loader) => {
      if ((loader as { id?: string } | null)?.id === "forge")
        throw new AppError("LOADER_UNKNOWN", "Unknown loader.");
    },
    worldOptions,
    worldsWithBackups: (profileId) => listWorlds(paths, profileId),
    forgetInLibraries,
    openFolder: () => Promise.resolve(),
    listAccounts: () =>
      Promise.resolve([
        { id: "acc-a", uuid: "0000000000000000000000000000000a" },
        { id: "acc-b", uuid: "0000000000000000000000000000000b" },
      ]),
    createShortcut: () => Promise.resolve("shortcut"),
    logger,
  });
  return { service, runtime, profiles, mods, playTime, settings, modpacks };
}

const create = (service: ReturnType<typeof setup>["service"], name: string) =>
  service.api.createProfile({
    name,
    gameVersion: "1.21.4",
    loader: { id: "fabric" },
  });

/** A world owned by the profile, linked into its `saves/`. */
async function world(profileId: string, id: string) {
  const w = paths.worldDir(id);
  await mkdir(w, { recursive: true });
  await writeFile(join(w, "level.dat"), "level");
  await writeFile(
    join(w, WORLD_FLAG),
    JSON.stringify({ schema: 1, profileId }),
  );
}

describe("createProfileService", () => {
  it("refuses a loader no provider has", async () => {
    const { service } = setup();
    await expect(
      service.api.createProfile({
        name: "Forge",
        gameVersion: "1.21.4",
        loader: { id: "forge" },
      }),
    ).rejects.toMatchObject({ code: "LOADER_UNKNOWN" });
  });

  it("duplicates settings and enabled mods, but not worlds by default", async () => {
    const { service, mods } = setup();
    const src = await create(service, "Survival");
    const folder = join(dir, "downloads");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "sodium.jar"), fabricMod("sodium", "0.6.0"));
    const [stored] = await mods.add([join(folder, "sodium.jar")]);
    await mods.enable(src.id, stored?.sha1 ?? "");
    await world(src.id, "Home");
    await syncWorlds(
      { paths, logger },
      { profileIds: [src.id], isRunning: () => false },
    );

    const copy = await service.api.duplicateProfile(src.id);
    expect(copy).toMatchObject({
      name: "Survival (copy)",
      gameVersion: "1.21.4",
    });
    expect((await mods.enabledMods(copy.id)).map((m) => m.sha1)).toEqual([
      stored?.sha1,
    ]);
    expect(await service.api.listWorlds(copy.id)).toEqual([]);
  });

  it("deletes a profile, moving its worlds to another one", async () => {
    const { service, settings, modpacks, playTime } = setup();
    const a = await create(service, "A");
    const b = await create(service, "B");
    await world(a.id, "Home");
    await syncWorlds(
      { paths, logger },
      { profileIds: [a.id, b.id], isRunning: () => false },
    );
    await settings.update({ selectedProfileId: a.id });
    await playTime.record(a.id, {
      startedAt: 0,
      endedAt: 60_000,
      accountId: "x",
    });

    await expect(
      service.api.deleteProfile(a.id, { moveTo: a.id }),
    ).rejects.toMatchObject({ code: "INVALID_PROFILE" });
    await service.api.deleteProfile(a.id, { moveTo: b.id });

    expect((await service.api.listProfiles()).map((p) => p.id)).toEqual([b.id]);
    expect((await service.api.listWorlds(b.id)).map((w) => w.id)).toEqual([
      "Home",
    ]);
    expect(await exists(paths.gameDir(a.id))).toBe(false);
    expect(modpacks.forgetProfile).toHaveBeenCalledWith(a.id);
    expect((await playTime.totals()).has(a.id)).toBe(false);
    expect((await settings.load()).selectedProfileId).toBeNull();
  });

  it("reads a world's map info, taking the selected account's player file", async () => {
    const { service, settings } = setup();
    const a = await create(service, "A");
    await world(a.id, "Home");
    const nbt = (entries: Record<string, Tag>): Uint8Array =>
      gzipSync(
        writeNbt("", { type: TAG.COMPOUND, value: Object.entries(entries) }),
      );
    const at = (x: number): Compound => ({
      type: TAG.COMPOUND,
      value: [
        ["Dimension", { type: TAG.STRING, value: "minecraft:overworld" }],
        [
          "Pos",
          {
            type: TAG.LIST,
            itemType: TAG.DOUBLE,
            value: [x, 64, 0].map((value) => ({ type: TAG.DOUBLE, value })),
          },
        ],
      ],
    });
    const dir = paths.worldDir("Home");
    await writeFile(
      join(dir, "level.dat"),
      nbt({
        Data: {
          type: TAG.COMPOUND,
          value: [["RandomSeed", { type: TAG.LONG, value: 7n }]],
        },
      }),
    );
    await mkdir(join(dir, "playerdata"));
    const file = (uuid: string) => join(dir, "playerdata", `${uuid}.dat`);
    await writeFile(
      file("00000000-0000-0000-0000-00000000000a"),
      nbt(Object.fromEntries(at(1).value)),
    );
    await writeFile(
      file("00000000-0000-0000-0000-00000000000b"),
      nbt(Object.fromEntries(at(2).value)),
    );
    await writeFile(
      file("00000000-0000-0000-0000-0000000000ff"),
      nbt(Object.fromEntries(at(3).value)),
    );

    await settings.update({ selectedAccountId: "acc-b" });
    expect(await service.api.getWorldMap(a.id, "Home")).toMatchObject({
      seed: "7",
      playerFound: true,
      player: { x: 2 },
    });
    await settings.update({ selectedAccountId: null });
    // No selected account: the newest file of a launcher account, never a stranger's.
    expect((await service.api.getWorldMap(a.id, "Home")).player?.x).not.toBe(3);

    await expect(service.api.getWorldMap(a.id, "Nope")).rejects.toMatchObject({
      code: "WORLD_NOT_FOUND",
    });
  });

  it("reads a 26.x world's seed file and the host's player file", async () => {
    const { service } = setup();
    const a = await create(service, "A");
    await world(a.id, "New");
    const tag = (entries: [string, Tag][]): Compound => ({
      type: TAG.COMPOUND,
      value: entries,
    });
    const nbt = (root: Compound) => gzipSync(writeNbt("", root));
    const player = (x: number) =>
      nbt(
        tag([
          [
            "Pos",
            {
              type: TAG.LIST,
              itemType: TAG.DOUBLE,
              value: [x, 64, 0].map((value) => ({ type: TAG.DOUBLE, value })),
            },
          ],
        ]),
      );
    const dir = paths.worldDir("New");
    await writeFile(
      join(dir, "level.dat"),
      nbt(
        tag([
          [
            "Data",
            tag([
              [
                "singleplayer_uuid",
                { type: TAG.INT_ARRAY, value: Int32Array.from([0, 0, 0, 255]) },
              ],
            ]),
          ],
        ]),
      ),
    );
    await mkdir(join(dir, "data", "minecraft"), { recursive: true });
    await writeFile(
      join(dir, "data", "minecraft", "world_gen_settings.dat"),
      nbt(tag([["data", tag([["seed", { type: TAG.LONG, value: -5n }]])]])),
    );
    await mkdir(join(dir, "players", "data"), { recursive: true });
    // The host (…00ff) wins over the launcher's own accounts.
    await writeFile(
      join(dir, "players", "data", "00000000-0000-0000-0000-0000000000ff.dat"),
      player(4),
    );
    await writeFile(
      join(dir, "players", "data", "00000000-0000-0000-0000-00000000000a.dat"),
      player(5),
    );
    expect(await service.api.getWorldMap(a.id, "New")).toMatchObject({
      seed: "-5",
      playerFound: true,
      player: { x: 4 },
    });
  });

  it("refuses a world whose level.dat isn't NBT", async () => {
    const { service } = setup();
    const a = await create(service, "A");
    await world(a.id, "Home");
    await expect(service.api.getWorldMap(a.id, "Home")).rejects.toMatchObject({
      code: "WORLD_UNREADABLE",
    });
  });

  it("deletes a profile's own worlds when asked, never while it plays", async () => {
    const { service, runtime } = setup();
    const a = await create(service, "A");
    await world(a.id, "Home");
    runtime.starting.add(`${a.id}:acc`);
    await expect(
      service.api.deleteProfile(a.id, "delete"),
    ).rejects.toMatchObject({ code: "GAME_RUNNING" });
    runtime.starting.clear();
    await service.api.deleteProfile(a.id, "delete");
    expect(await readdir(paths.worldsDir)).toEqual([]);
  });
});
