import type { ProfileInfo, ProfileSort } from "@shared/launcher";

/** When a profile was last used: played, else created. */
const lastUsed = (p: ProfileInfo) => p.lastPlayedAt ?? p.createdAt;

function comparator(
  sort: ProfileSort,
  collator: Intl.Collator,
): (a: ProfileInfo, b: ProfileInfo) => number {
  const byLastUsed = (a: ProfileInfo, b: ProfileInfo) =>
    lastUsed(b).localeCompare(lastUsed(a));
  switch (sort) {
    case "name":
      return (a, b) => collator.compare(a.name, b.name) || byLastUsed(a, b);
    case "playTime":
      return (a, b) =>
        (b.playTimeMs ?? 0) - (a.playTimeMs ?? 0) || byLastUsed(a, b);
    case "created":
      return (a, b) => b.createdAt.localeCompare(a.createdAt);
    case "lastPlayed":
      return byLastUsed;
  }
}

/** Pinned profiles, then the others, each in the chosen order. */
export function sortProfiles(
  profiles: readonly ProfileInfo[],
  sort: ProfileSort,
  language: string,
): { pinned: ProfileInfo[]; others: ProfileInfo[] } {
  const compare = comparator(
    sort,
    new Intl.Collator(language, { numeric: true, sensitivity: "base" }),
  );
  const sorted = [...profiles].sort(compare);
  return {
    pinned: sorted.filter((p) => p.pinned === true),
    others: sorted.filter((p) => p.pinned !== true),
  };
}
