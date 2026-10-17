/*
 * The launcher's own versions (package.json), which are semver: `1.2.3` or
 * `1.2.3-beta.1`. Not for Minecraft version ids, which are opaque.
 */

const SEMVER =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

interface Parsed {
  core: [number, number, number];
  pre: string[];
}

function parse(version: string): Parsed | undefined {
  const m = SEMVER.exec(version.trim());
  if (!m) return undefined;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split(".") : [],
  };
}

export function isSemver(version: string): boolean {
  return parse(version) !== undefined;
}

/** `true` for versions like `1.2.0-beta.1`. */
export function isPrerelease(version: string): boolean {
  return (parse(version)?.pre.length ?? 0) > 0;
}

function comparePre(a: string[], b: string[]): number {
  // A release sorts after its pre-releases.
  if (a.length === 0 || b.length === 0) return b.length - a.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d !== 0) return Math.sign(d);
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** Negative when `a` is older than `b`, positive when newer. Throws on a non-semver version. */
export function compareVersions(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) throw new Error(`Not a version: ${x ? b : a}`);
  for (const [i, part] of x.core.entries()) {
    const d = part - (y.core[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return comparePre(x.pre, y.pre);
}
