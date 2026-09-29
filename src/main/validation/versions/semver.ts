/** A dotted version with an optional pre-release tag, e.g. `1.20.5-alpha.24.12.a`. */
export interface SemVer {
  nums: number[];
  /** Pre-release tag; a version with one sorts before the same version without. */
  pre?: string;
}

/** Parse `1.18.2`, `0.15`, `1.19-beta.1`. Build metadata (`+…`) is ignored. */
export function parseSemVer(text: string): SemVer | undefined {
  const match =
    /^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]*))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      text.trim(),
    );
  if (!match?.[1]) return undefined;
  const nums = match[1].split(".").map(Number);
  if (nums.some((n) => !Number.isSafeInteger(n))) return undefined;
  return match[2] !== undefined ? { nums, pre: match[2] } : { nums };
}

function comparePre(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x) ? Number(x) : undefined;
    const ny = /^\d+$/.test(y) ? Number(y) : undefined;
    if (nx !== undefined && ny !== undefined) {
      if (nx !== ny) return nx - ny;
    } else if (nx !== undefined) return -1;
    else if (ny !== undefined) return 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Numeric parts first (missing parts count as 0), then pre-release before release. */
export function compareSemVer(a: SemVer, b: SemVer): number {
  for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i++) {
    const diff = (a.nums[i] ?? 0) - (b.nums[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (a.pre === undefined && b.pre === undefined) return 0;
  if (a.pre === undefined) return 1;
  if (b.pre === undefined) return -1;
  return comparePre(a.pre, b.pre);
}
