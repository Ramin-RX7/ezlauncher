import type { SemVer } from "./semver";

/** What the version manifest says about a version; enough to place a snapshot. */
export interface McVersionEntry {
  id: string;
  type: string;
  releaseTime: string;
}

const RELEASE = /^\d+(\.\d+){1,2}$/;

function release(id: string): number[] {
  return id.split(".").map(Number);
}

/**
 * A Minecraft version id as a comparable version, the way Fabric sees it:
 * - releases as they are: `1.18.2`, `1.21`, `26.3`;
 * - `1.19-pre1` → `1.19-beta.1`, `1.19-rc1` → `1.19-rc.1`, `26.4-snapshot-1` → `26.4-alpha.1`;
 * - weekly snapshots (`22w13a`) → `<next release>-alpha.22.13.a`, where the next release
 *   is the first one out after the snapshot (needs the manifest in `versions`).
 * Anything else (April Fools', old betas, a snapshot without the manifest) is undefined,
 * so checks involving it are "unknown".
 */
export function parseMcVersion(
  id: string,
  versions?: readonly McVersionEntry[],
): SemVer | undefined {
  if (RELEASE.test(id)) return { nums: release(id) };

  const pre = /^(\d+(?:\.\d+){1,2})-(pre|rc|snapshot)-?(\d+)$/.exec(id);
  if (pre?.[1] && pre[2] && pre[3]) {
    const tag = { pre: "beta", rc: "rc", snapshot: "alpha" }[
      pre[2] as "pre" | "rc" | "snapshot"
    ];
    return { nums: release(pre[1]), pre: `${tag}.${pre[3]}` };
  }

  const weekly = /^(\d\d)w(\d\d)([a-z])$/.exec(id);
  if (weekly && versions) {
    const self = versions.find((v) => v.id === id);
    if (!self) return undefined;
    const time = Date.parse(self.releaseTime);
    const next = versions
      .filter(
        (v) =>
          v.type === "release" &&
          RELEASE.test(v.id) &&
          Date.parse(v.releaseTime) > time,
      )
      .sort((a, b) => Date.parse(a.releaseTime) - Date.parse(b.releaseTime))[0];
    if (!next) return undefined;
    return {
      nums: release(next.id),
      pre: `alpha.${Number(weekly[1])}.${Number(weekly[2])}.${weekly[3] ?? "a"}`,
    };
  }
  return undefined;
}
