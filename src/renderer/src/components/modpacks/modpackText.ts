export { loaderLabel } from "../mods/compatText";

/** Loaders a mod pack can be made for that this launcher runs (`minecraft` = vanilla). */
const RUNNABLE = new Set(["fabric", "quilt", "minecraft"]);

/** Can a pack (or pack version) with these loaders be imported? Unknown counts as yes. */
export function isSupportedPack(
  loaders: readonly string[] | undefined,
): boolean {
  if (!loaders || loaders.length === 0) return true;
  return loaders.some((l) => RUNNABLE.has(l));
}
