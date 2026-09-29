import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FileTask } from "./fileTask";
import { safeJoin, type Paths } from "./paths";
import type { AssetIndex, VersionJson } from "./schemas";

export const RESOURCES_URL = "https://resources.download.minecraft.net/";

/** One download per unique object hash; many asset names can share the same file. */
export function assetObjectTasks(index: AssetIndex, paths: Paths): FileTask[] {
  const seen = new Set<string>();
  const tasks: FileTask[] = [];
  for (const { hash, size } of Object.values(index.objects)) {
    if (seen.has(hash)) continue;
    seen.add(hash);
    tasks.push({
      dest: paths.assetObject(hash),
      url: `${RESOURCES_URL}${hash.slice(0, 2)}/${hash}`,
      sha1: hash,
      size,
    });
  }
  return tasks;
}

export function assetIndexId(version: VersionJson): string {
  return version.assetIndex?.id ?? version.assets ?? "legacy";
}

/**
 * The folder passed as `${game_assets}`: old versions read assets by name, not by hash,
 * from a "virtual" copy (`legacy` index) or from the game folder's `resources/` (`pre-1.6`).
 */
export function gameAssetsDir(
  index: AssetIndex,
  indexId: string,
  paths: Paths,
  gameDir: string,
): string {
  if (index.map_to_resources) return join(gameDir, "resources");
  if (index.virtual) return paths.assetsVirtual(indexId);
  return paths.assetsDir;
}

async function sameSize(path: string, size: number): Promise<boolean> {
  try {
    return (await stat(path)).size === size;
  } catch {
    return false;
  }
}

/** Copy objects to their by-name locations for old versions. No-op for modern indexes. */
export async function applyLegacyAssets(
  index: AssetIndex,
  indexId: string,
  paths: Paths,
  gameDir: string,
): Promise<void> {
  if (!index.virtual && !index.map_to_resources) return;
  const root = gameAssetsDir(index, indexId, paths, gameDir);
  for (const [name, { hash, size }] of Object.entries(index.objects)) {
    const target = safeJoin(root, name);
    if (await sameSize(target, size)) continue;
    await mkdir(dirname(target), { recursive: true });
    await copyFile(paths.assetObject(hash), target);
  }
}
