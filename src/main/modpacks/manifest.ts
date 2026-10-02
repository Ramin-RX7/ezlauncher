import { rm } from "node:fs/promises";
import { z } from "zod";
import { readJson, writeJsonAtomic } from "../core/fsAtomic";
import type { Paths } from "../minecraft/paths";

/*
 * `launcher/modpacks/<profileId>.json`: what a mod pack put into a profile, so an
 * update can tell the pack's files from the user's, and changed files from
 * untouched ones. The profile record holds only the pack's name and version.
 */

const manifestSchema = z.object({
  schema: z.literal(1),
  name: z.string(),
  versionNumber: z.string(),
  source: z
    .object({
      sourceId: z.string(),
      projectId: z.string(),
      versionId: z.string(),
    })
    .optional(),
  /** Every file the pack wrote (downloads and overrides) → its SHA1 as written. */
  files: z.record(z.string(), z.string()),
  /** Optional files the user left out; updates leave them out too. */
  skipped: z.array(z.string()),
});
export type PackManifest = z.infer<typeof manifestSchema>;

export function readManifest(
  paths: Paths,
  profileId: string,
): Promise<PackManifest | undefined> {
  return readJson(paths.modpackManifest(profileId), manifestSchema).catch(
    () => undefined,
  );
}

export function writeManifest(
  paths: Paths,
  profileId: string,
  manifest: PackManifest,
): Promise<void> {
  return writeJsonAtomic(paths.modpackManifest(profileId), manifest);
}

export async function removeManifest(
  paths: Paths,
  profileId: string,
): Promise<void> {
  await rm(paths.modpackManifest(profileId), { force: true });
}
