import { z } from "zod";
import type { LauncherSettings } from "@shared/launcher";
import { AppError } from "../core/errors";
import { readJson, writeJsonAtomic } from "../core/fsAtomic";

export const DEFAULT_SETTINGS: LauncherSettings = {
  memoryMaxMb: 2048,
  onGameStart: "keep",
};

const memorySchema = z.number().int().min(512).max(65536);
const onGameStartSchema = z.enum(["keep", "minimize", "close"]);

const fileSchema = z.object({
  schema: z.literal(1),
  memoryMaxMb: memorySchema.catch(DEFAULT_SETTINGS.memoryMaxMb),
  onGameStart: onGameStartSchema.catch(DEFAULT_SETTINGS.onGameStart),
});

const patchSchema = z
  .object({ memoryMaxMb: memorySchema, onGameStart: onGameStartSchema })
  .partial()
  .strict();

/** `launcher/settings.json`. Missing or invalid values fall back to the defaults. */
export function createSettingsStore(file: string) {
  async function load(): Promise<LauncherSettings> {
    try {
      const data = await readJson(file, fileSchema);
      if (!data) return { ...DEFAULT_SETTINGS };
      return { memoryMaxMb: data.memoryMaxMb, onGameStart: data.onGameStart };
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
