import type { Profile, VersionSummary } from "@shared/launcher";

/**
 * Moving a world to `to` can damage it when that profile runs an older Minecraft
 * version (by release date) or a different loader.
 */
export function isRiskyMove(
  from: Pick<Profile, "gameVersion" | "loader"> | undefined,
  to: Pick<Profile, "gameVersion" | "loader">,
  versions: readonly VersionSummary[],
): boolean {
  if (!from) return false;
  if ((from.loader?.id ?? null) !== (to.loader?.id ?? null)) return true;
  const time = (id: string) =>
    Date.parse(
      versions.find((v) => v.id === id && !v.loader)?.releaseTime ?? "",
    );
  const a = time(from.gameVersion);
  const b = time(to.gameVersion);
  return Number.isFinite(a) && Number.isFinite(b) && b < a;
}
