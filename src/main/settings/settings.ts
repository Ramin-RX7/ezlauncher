import { z } from "zod";
import {
  GAME_WINDOW_LIMITS,
  PROFILE_SORTS,
  type LauncherSettings,
} from "@shared/launcher";
import { AppError } from "../core/errors";
import { readJson, writeJsonAtomic } from "../core/fsAtomic";

export const DEFAULT_SETTINGS: LauncherSettings = {
  memoryMaxMb: 2048,
  extraJvmArgs: [],
  extraGameArgs: [],
  gameWindow: { mode: "default" },
  onGameStart: "keep",
  showSnapshots: false,
  showOldBeta: false,
  showOldAlpha: false,
  // Off by default: backups take disk space, so the user turns them on.
  backupAuto: "off",
  backupWhen: "afterExit",
  backupIntervalDays: 7,
  backupKeepCount: 10,
  backupKeepDays: 30,
  profileSort: "lastPlayed",
  selectedProfileId: null,
  selectedAccountId: null,
};

const memorySchema = z.number().int().min(512).max(65536);
const onGameStartSchema = z.enum(["keep", "minimize", "close"]);
const selectionSchema = z.string().max(64).nullable();
const profileSortSchema = z.enum(PROFILE_SORTS);
export const argsSchema = z.array(z.string().max(4096)).max(200);
const backupAutoSchema = z.enum(["off", "launch", "interval"]);
const backupWhenSchema = z.enum(["beforeStart", "afterExit"]);
const intervalSchema = z.number().int().min(1).max(365);
const keepCountSchema = z.number().int().min(1).max(100).nullable();
const keepDaysSchema = z.number().int().min(1).max(3650).nullable();
const { minWidth, minHeight, max } = GAME_WINDOW_LIMITS;
/** How the game's window opens; also a profile's override. */
export const gameWindowSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("default") }).strict(),
  z
    .object({
      mode: z.literal("size"),
      width: z.number().int().min(minWidth).max(max),
      height: z.number().int().min(minHeight).max(max),
    })
    .strict(),
  z.object({ mode: z.literal("fullscreen") }).strict(),
]);

const fileSchema = z.object({
  schema: z.literal(1),
  memoryMaxMb: memorySchema.catch(DEFAULT_SETTINGS.memoryMaxMb),
  extraJvmArgs: argsSchema.optional().catch([]),
  extraGameArgs: argsSchema.optional().catch([]),
  gameWindow: gameWindowSchema.optional().catch(DEFAULT_SETTINGS.gameWindow),
  onGameStart: onGameStartSchema.catch(DEFAULT_SETTINGS.onGameStart),
  showSnapshots: z.boolean().optional().catch(false),
  showOldBeta: z.boolean().optional().catch(false),
  showOldAlpha: z.boolean().optional().catch(false),
  backupAuto: backupAutoSchema.optional().catch(DEFAULT_SETTINGS.backupAuto),
  backupWhen: backupWhenSchema.optional().catch(DEFAULT_SETTINGS.backupWhen),
  backupIntervalDays: intervalSchema
    .optional()
    .catch(DEFAULT_SETTINGS.backupIntervalDays),
  backupKeepCount: keepCountSchema
    .optional()
    .catch(DEFAULT_SETTINGS.backupKeepCount),
  backupKeepDays: keepDaysSchema
    .optional()
    .catch(DEFAULT_SETTINGS.backupKeepDays),
  profileSort: profileSortSchema.optional().catch(DEFAULT_SETTINGS.profileSort),
  selectedProfileId: selectionSchema.optional().catch(null),
  selectedAccountId: selectionSchema.optional().catch(null),
});

const patchSchema = z
  .object({
    memoryMaxMb: memorySchema,
    extraJvmArgs: argsSchema,
    extraGameArgs: argsSchema,
    gameWindow: gameWindowSchema,
    onGameStart: onGameStartSchema,
    showSnapshots: z.boolean(),
    showOldBeta: z.boolean(),
    showOldAlpha: z.boolean(),
    backupAuto: backupAutoSchema,
    backupWhen: backupWhenSchema,
    backupIntervalDays: intervalSchema,
    backupKeepCount: keepCountSchema,
    backupKeepDays: keepDaysSchema,
    profileSort: profileSortSchema,
    selectedProfileId: selectionSchema,
    selectedAccountId: selectionSchema,
  })
  .partial()
  .strict();

/** `launcher/settings.json`. Missing or invalid values fall back to the defaults. */
export function createSettingsStore(file: string) {
  async function load(): Promise<LauncherSettings> {
    try {
      const data = await readJson(file, fileSchema);
      if (!data) return { ...DEFAULT_SETTINGS };
      return {
        memoryMaxMb: data.memoryMaxMb,
        extraJvmArgs: data.extraJvmArgs ?? [],
        extraGameArgs: data.extraGameArgs ?? [],
        gameWindow: data.gameWindow ?? DEFAULT_SETTINGS.gameWindow,
        onGameStart: data.onGameStart,
        showSnapshots: data.showSnapshots ?? false,
        showOldBeta: data.showOldBeta ?? false,
        showOldAlpha: data.showOldAlpha ?? false,
        backupAuto: data.backupAuto ?? DEFAULT_SETTINGS.backupAuto,
        backupWhen: data.backupWhen ?? DEFAULT_SETTINGS.backupWhen,
        backupIntervalDays:
          data.backupIntervalDays ?? DEFAULT_SETTINGS.backupIntervalDays,
        // null is a real value here ("no limit"): only a missing one takes the default.
        backupKeepCount:
          data.backupKeepCount === undefined
            ? DEFAULT_SETTINGS.backupKeepCount
            : data.backupKeepCount,
        backupKeepDays:
          data.backupKeepDays === undefined
            ? DEFAULT_SETTINGS.backupKeepDays
            : data.backupKeepDays,
        profileSort: data.profileSort ?? DEFAULT_SETTINGS.profileSort,
        selectedProfileId: data.selectedProfileId ?? null,
        selectedAccountId: data.selectedAccountId ?? null,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  return {
    load,
    async update(patch: unknown): Promise<LauncherSettings> {
      const parsed = patchSchema.safeParse(patch);
      if (!parsed.success)
        throw new AppError("INVALID_SETTINGS", "Invalid settings value.");
      const next = { ...(await load()), ...parsed.data };
      await writeJsonAtomic(file, { schema: 1, ...next });
      return next;
    },
  };
}
